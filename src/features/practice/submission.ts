import type { ScoreResult } from '../../types';

export interface LegacyAnswerRecord {
  id: string;
  text: string;
}

interface LegacySubmissionIdentity {
  userId: string;
  sessionId: string;
  questionId: string;
}

export interface LegacySubmissionDependencies {
  findAnswer: (identity: LegacySubmissionIdentity) => Promise<LegacyAnswerRecord | null>;
  createAnswer: (input: LegacySubmissionIdentity & { text: string }) => Promise<LegacyAnswerRecord>;
  findScore: (answerId: string) => Promise<ScoreResult | null>;
  createScore: (answerId: string, score: ScoreResult) => Promise<void>;
  finalizeSession: (sessionId: string, score: ScoreResult) => Promise<void>;
  scoreAnswer: (questionText: string, answerText: string) => Promise<ScoreResult>;
}

export interface LegacySubmissionInput extends LegacySubmissionIdentity {
  questionText: string;
  answerText: string;
}

export async function submitLegacyAnswer(
  dependencies: LegacySubmissionDependencies,
  input: LegacySubmissionInput,
): Promise<ScoreResult> {
  const identity = {
    userId: input.userId,
    sessionId: input.sessionId,
    questionId: input.questionId,
  };
  const normalizedAnswer = input.answerText.trim();
  const existingAnswer = await dependencies.findAnswer(identity);

  if (existingAnswer && existingAnswer.text.trim() !== normalizedAnswer) {
    throw new Error('answer_conflict');
  }

  if (existingAnswer) {
    const existingScore = await dependencies.findScore(existingAnswer.id);
    if (existingScore) {
      await dependencies.finalizeSession(input.sessionId, existingScore);
      return existingScore;
    }
  }

  // Provider success is required before creating a new answer row. This keeps
  // configuration/network failures from leaving an orphaned logical attempt.
  const score = await dependencies.scoreAnswer(input.questionText, normalizedAnswer);
  const answer = existingAnswer ?? await dependencies.createAnswer({
    ...identity,
    text: normalizedAnswer,
  });

  await dependencies.createScore(answer.id, score);
  await dependencies.finalizeSession(input.sessionId, score);
  return score;
}
