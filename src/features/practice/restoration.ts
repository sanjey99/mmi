import type { MockSession, Question } from '../../types';

export type PracticeRestorationCode =
  | 'invalid_route'
  | 'restore_not_found'
  | 'session_closed'
  | 'restore_mismatch';

export class PracticeRestorationError extends Error {
  constructor(public readonly code: PracticeRestorationCode) {
    super(code);
    this.name = 'PracticeRestorationError';
  }
}

export interface PracticeRestorationSource {
  getOwnedSession: (userId: string, sessionId: string) => Promise<MockSession | null>;
  getActiveQuestion: (questionId: string) => Promise<Question | null>;
}

interface PracticeRestorationRequest {
  userId: string;
  sessionId: string;
  questionId: string;
}

export async function restorePracticeSession(
  source: PracticeRestorationSource,
  request: PracticeRestorationRequest,
): Promise<{ session: MockSession; question: Question }> {
  if (![request.userId, request.sessionId, request.questionId].every(value => value.trim().length > 0)) {
    throw new PracticeRestorationError('invalid_route');
  }

  const [session, question] = await Promise.all([
    source.getOwnedSession(request.userId, request.sessionId),
    source.getActiveQuestion(request.questionId),
  ]);

  if (!session || !question) {
    throw new PracticeRestorationError('restore_not_found');
  }
  if (session.completed || session.ended_at) {
    throw new PracticeRestorationError('session_closed');
  }
  if (session.category_filter !== question.category) {
    throw new PracticeRestorationError('restore_mismatch');
  }

  return { session, question };
}
