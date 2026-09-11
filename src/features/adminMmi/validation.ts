import type {
  AdminMmiCriterionDraft,
  AdminMmiEqualWeightPreview,
  AdminMmiQuestionDraft,
  AdminMmiStationDraft,
  AdminMmiStationValidation,
  AdminMmiValidationIssue,
  AdminMmiValidationMode,
} from './types';
import { isMmiSourceId } from '../mmi/sourceId';

const ALLOWED_DIFFICULTIES = new Set(['foundation', 'intermediate', 'advanced']);

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function issue(
  issues: AdminMmiValidationIssue[],
  path: string,
  code: AdminMmiValidationIssue['code'],
  message: string,
): void {
  issues.push(Object.freeze({ path, code, message }));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeText(value);
  return normalized.length === 0 ? null : normalized;
}

function validateText(
  issues: AdminMmiValidationIssue[],
  path: string,
  value: string,
  maximum: number,
  required: boolean,
): void {
  if (required && value.length === 0) issue(issues, path, 'required', 'This field is required.');
  if (codePointLength(value) > maximum) issue(issues, path, 'too_long', `Use at most ${maximum} characters.`);
}

function freezeCriterion(criterion: AdminMmiCriterionDraft): AdminMmiCriterionDraft {
  return Object.freeze({ ...criterion });
}

function freezeQuestion(question: AdminMmiQuestionDraft): AdminMmiQuestionDraft {
  return Object.freeze({
    ...question,
    criteria: Object.freeze(question.criteria.map(freezeCriterion)),
  });
}

function freezeStation(station: AdminMmiStationDraft): AdminMmiStationDraft {
  return Object.freeze({
    ...station,
    universityTags: Object.freeze([...station.universityTags]),
    questions: Object.freeze(station.questions.map(freezeQuestion)),
  });
}

function normalizeStation(input: AdminMmiStationDraft): AdminMmiStationDraft {
  const normalizedTags = input.universityTags.map((tag) => tag.trim().toLowerCase());
  const uniqueTags = normalizedTags.filter((tag, index) => tag.length > 0 && normalizedTags.indexOf(tag) === index);
  return freezeStation({
    stationId: normalizeText(input.stationId),
    expectedVersion: input.expectedVersion,
    category: normalizeText(input.category),
    topic: normalizeText(input.topic),
    difficulty: input.difficulty,
    universityTags: uniqueTags,
    prepTimeSec: input.prepTimeSec,
    imageUrl: normalizeNullable(input.imageUrl),
    scenarioText: normalizeText(input.scenarioText),
    questions: input.questions.map((question) => ({
      subQuestionId: normalizeText(question.subQuestionId),
      order: question.order,
      questionText: normalizeText(question.questionText),
      timeLimitSec: question.timeLimitSec,
      modelAnswerCached: normalizeNullable(question.modelAnswerCached),
      criteria: question.criteria.map((criterion) => ({
        criterionId: normalizeText(criterion.criterionId),
        order: criterion.order,
        bulletText: normalizeText(criterion.bulletText),
        domain: normalizeNullable(criterion.domain),
        sourceWeight: criterion.sourceWeight,
      })),
    })),
  });
}

function equalWeights(station: AdminMmiStationDraft): readonly AdminMmiEqualWeightPreview[] {
  return Object.freeze(station.questions.map((question) => {
    const weightPct = question.criteria.length === 0
      ? 0
      : Math.round((100 / question.criteria.length) * 100) / 100;
    return Object.freeze({
      subQuestionId: question.subQuestionId,
      criteria: Object.freeze(question.criteria.map((criterion) => Object.freeze({
        criterionId: criterion.criterionId,
        weightPct,
      }))),
    });
  }));
}

export function validateStationDraft(
  input: AdminMmiStationDraft,
  mode: AdminMmiValidationMode,
): AdminMmiStationValidation {
  const value = normalizeStation(input);
  const issues: AdminMmiValidationIssue[] = [];
  const requiredForPublish = mode === 'publish';

  if (!isMmiSourceId(value.stationId)) issue(issues, 'stationId', 'invalid_id', 'Use a stable station ID.');
  if (value.expectedVersion !== null && (!Number.isInteger(value.expectedVersion) || value.expectedVersion < 1)) {
    issue(issues, 'expectedVersion', 'invalid_number', 'Version must be a positive integer.');
  }
  validateText(issues, 'category', value.category, 100, requiredForPublish);
  validateText(issues, 'topic', value.topic, 100, requiredForPublish);
  validateText(issues, 'scenarioText', value.scenarioText, 10_000, requiredForPublish);
  if (!ALLOWED_DIFFICULTIES.has(value.difficulty)) issue(issues, 'difficulty', 'required', 'Choose a supported difficulty.');
  if (value.prepTimeSec !== 60) issue(issues, 'prepTimeSec', 'invalid_prep_time', 'Published stations use 60 seconds of preparation.');
  if (input.universityTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean).length !== value.universityTags.length) {
    issue(issues, 'universityTags', 'duplicate_tag', 'University tags must be unique after normalization.');
  }
  for (const [index, tag] of value.universityTags.entries()) {
    validateText(issues, `universityTags.${index}`, tag, 100, false);
  }
  if (value.imageUrl !== null) {
    let valid = codePointLength(value.imageUrl) <= 2_000;
    try {
      const url = new URL(value.imageUrl);
      valid = valid && url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      valid = false;
    }
    if (!valid) issue(issues, 'imageUrl', 'invalid_url', 'Use a bounded HTTPS image URL without credentials.');
  }

  const orders = value.questions.map((question) => question.order);
  if (requiredForPublish && (
    value.questions.length !== 5
    || new Set(orders).size !== 5
    || [...orders].sort((left, right) => left - right).some((order, index) => order !== index + 1)
  )) issue(issues, 'questions', 'invalid_question_orders', 'Publishing requires question orders 1 through 5 exactly once.');
  if (value.questions.length > 5) issue(issues, 'questions', 'invalid_question_orders', 'A station has at most five questions.');

  const stationCriterionIds = new Set<string>();
  for (const [questionIndex, question] of value.questions.entries()) {
    const path = `questions.${questionIndex}`;
    if (!isMmiSourceId(question.subQuestionId)) issue(issues, `${path}.subQuestionId`, 'invalid_id', 'Use a stable sub-question ID.');
    if (!Number.isInteger(question.order) || question.order < 1 || question.order > 5) issue(issues, `${path}.order`, 'invalid_question_orders', 'Question order must be 1 through 5.');
    if (question.timeLimitSec !== 120) issue(issues, `${path}.timeLimitSec`, 'invalid_response_time', 'Each response uses 120 seconds.');
    validateText(issues, `${path}.questionText`, question.questionText, 10_000, requiredForPublish);
    if (question.modelAnswerCached !== null) validateText(issues, `${path}.modelAnswerCached`, question.modelAnswerCached, 20_000, false);
    if (requiredForPublish && question.criteria.length === 0) issue(issues, `${path}.criteria`, 'required', 'Each published question needs marking criteria.');
    if (question.criteria.length > 20) issue(issues, `${path}.criteria`, 'invalid_number', 'Use at most 20 criteria per question.');
    const criterionIds = question.criteria.map((criterion) => criterion.criterionId);
    const criterionOrders = question.criteria.map((criterion) => criterion.order);
    if (new Set(criterionIds).size !== criterionIds.length) issue(issues, `${path}.criteria`, 'duplicate_criterion_id', 'Criterion IDs must be unique per question.');
    if (new Set(criterionOrders).size !== criterionOrders.length) issue(issues, `${path}.criteria`, 'duplicate_criterion_order', 'Criterion orders must be unique per question.');
    for (const [criterionIndex, criterion] of question.criteria.entries()) {
      const criterionPath = `${path}.criteria.${criterionIndex}`;
      if (!isMmiSourceId(criterion.criterionId)) issue(issues, `${criterionPath}.criterionId`, 'invalid_id', 'Use a stable criterion ID.');
      if (stationCriterionIds.has(criterion.criterionId)) {
        issue(issues, `${criterionPath}.criterionId`, 'duplicate_criterion_id', 'Criterion IDs must be unique across the station.');
      }
      stationCriterionIds.add(criterion.criterionId);
      if (!Number.isInteger(criterion.order) || criterion.order < 1 || criterion.order > 20) issue(issues, `${criterionPath}.order`, 'invalid_number', 'Criterion order must be a positive integer.');
      validateText(issues, `${criterionPath}.bulletText`, criterion.bulletText, 2_000, requiredForPublish);
      if (criterion.domain !== null) validateText(issues, `${criterionPath}.domain`, criterion.domain, 100, false);
      if (!Number.isFinite(criterion.sourceWeight) || criterion.sourceWeight <= 0 || criterion.sourceWeight > 1_000_000) {
        issue(issues, `${criterionPath}.sourceWeight`, 'invalid_number', 'Source weight must be a positive finite number.');
      }
    }
  }

  return Object.freeze({
    value,
    issues: Object.freeze(issues),
    equalWeightPreview: equalWeights(value),
  });
}
