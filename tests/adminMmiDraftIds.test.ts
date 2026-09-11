import { describe, expect, it } from 'vitest';
import { addDraftCriterion, addDraftQuestion, createDraftIdReservations, createStationDraft, remapUnsavedStationDraft } from '../src/features/adminMmi/stationDraftIds';
import { createLatestRequestGate } from '../src/features/adminMmi/latestRequestGate';

describe('admin MMI draft descendant identities', () => {
  it('remaps every generated descendant when an unsaved station identity changes', () => {
    const initial = createStationDraft('new-station');
    const remapped = remapUnsavedStationDraft(initial, 'Oxford_01');
    expect(remapped.stationId).toBe('Oxford_01');
    expect(remapped.questions.map((question) => question.subQuestionId)).toEqual(['Oxford_01-q1', 'Oxford_01-q2', 'Oxford_01-q3', 'Oxford_01-q4', 'Oxford_01-q5']);
    expect(remapped.questions[0]!.criteria.map((criterion) => criterion.criterionId)).toEqual(['Oxford_01-q1-c1', 'Oxford_01-q1-c2', 'Oxford_01-q1-c3', 'Oxford_01-q1-c4']);
    expect(new Set(remapped.questions.flatMap((question) => [question.subQuestionId, ...question.criteria.map((criterion) => criterion.criterionId)])).size).toBe(25);
  });

  it('never reuses an ID after a middle item is removed', () => {
    const draft = createStationDraft('station-a');
    const reservations = createDraftIdReservations(draft);
    const withoutMiddle = { ...draft, questions: draft.questions.filter((question) => question.order !== 3) };
    const withQuestion = addDraftQuestion(withoutMiddle, reservations);
    expect(withQuestion.questions.map((question) => question.subQuestionId)).toContain('station-a-q6');
    const question = withQuestion.questions[0]!;
    const withoutMiddleCriterion = { ...withQuestion, questions: withQuestion.questions.map((item) => item.subQuestionId !== question.subQuestionId ? item : { ...item, criteria: item.criteria.filter((criterion) => criterion.order !== 2) }) };
    const withCriterion = addDraftCriterion(withoutMiddleCriterion, question.subQuestionId, reservations);
    expect(withCriterion.questions[0]!.criteria.map((criterion) => criterion.criterionId)).toContain('station-a-q1-c5');
  });

  it.each([null, 1])('tombstones the highest removed question and criterion suffix for %s drafts', (expectedVersion) => {
    const draft = { ...createStationDraft('station-high'), expectedVersion };
    const reservations = createDraftIdReservations(draft);
    const withoutHighestQuestion = { ...draft, questions: draft.questions.filter((question) => question.subQuestionId !== 'station-high-q5') };
    const withQuestion = addDraftQuestion(withoutHighestQuestion, reservations);
    expect(withQuestion.questions.map((question) => question.subQuestionId)).toContain('station-high-q6');

    const firstQuestion = withQuestion.questions[0]!;
    const withoutHighestCriterion = { ...withQuestion, questions: withQuestion.questions.map((question) => question.subQuestionId !== firstQuestion.subQuestionId ? question : { ...question, criteria: question.criteria.filter((criterion) => criterion.criterionId !== 'station-high-q1-c4') }) };
    const withCriterion = addDraftCriterion(withoutHighestCriterion, firstQuestion.subQuestionId, reservations);
    expect(withCriterion.questions[0]!.criteria.map((criterion) => criterion.criterionId)).toContain('station-high-q1-c5');
  });

  it('creates globally distinct descendants for a second new station', () => {
    const first = remapUnsavedStationDraft(createStationDraft('new-station'), 'station-one');
    const second = remapUnsavedStationDraft(createStationDraft('new-station'), 'station-two');
    const firstIds = new Set(first.questions.flatMap((question) => [question.subQuestionId, ...question.criteria.map((criterion) => criterion.criterionId)]));
    expect(second.questions.flatMap((question) => [question.subQuestionId, ...question.criteria.map((criterion) => criterion.criterionId)]).some((id) => firstIds.has(id))).toBe(false);
  });

  it('does not remap a loaded station identity or its existing descendants', () => {
    const loaded = { ...createStationDraft('loaded-station'), expectedVersion: 1 };
    expect(remapUnsavedStationDraft(loaded, 'renamed-station')).toBe(loaded);
  });

  it('marks an older repository response stale after a newer filter request starts', () => {
    const gate = createLatestRequestGate();
    const pageTwo = gate.begin();
    const filteredFirstPage = gate.begin();
    expect(gate.isCurrent(pageTwo)).toBe(false);
    expect(gate.isCurrent(filteredFirstPage)).toBe(true);
  });
});
