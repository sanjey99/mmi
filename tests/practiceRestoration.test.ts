import { describe, expect, it, vi } from 'vitest';
import { ownsCachedPracticeSession, restorePracticeSession } from '../src/features/practice/restoration';
import type { MockSession, Question } from '../src/types';

const session: MockSession = {
  id: 'session-1',
  user_id: 'user-1',
  mode: 'practice',
  category_filter: 'ethics',
  question_count: 1,
  started_at: '2026-08-25T00:00:00.000Z',
  ended_at: null,
  total_score_pct: null,
  completed: false,
};

const question: Question = {
  id: 'question-1',
  category: 'ethics',
  subcategory: null,
  text: 'How would you approach this ethical scenario?',
  guidance_notes: null,
  university_tags: [],
  difficulty: 'foundation',
  is_mmi_suitable: true,
  times_attempted: 0,
  avg_score: 0,
  created_at: '2026-08-25T00:00:00.000Z',
};

function source(overrides: Partial<{
  ownedSession: MockSession | null;
  activeQuestion: Question | null;
}> = {}) {
  return {
    getOwnedSession: vi.fn(async () => overrides.ownedSession === undefined ? session : overrides.ownedSession),
    getActiveQuestion: vi.fn(async () => overrides.activeQuestion === undefined ? question : overrides.activeQuestion),
  };
}

describe('restorePracticeSession', () => {
  it('restores only an owned open session whose stored category matches the active question', async () => {
    const dataSource = source();

    await expect(restorePracticeSession(dataSource, {
      userId: 'user-1',
      sessionId: 'session-1',
      questionId: 'question-1',
    })).resolves.toEqual({ session, question });
    expect(dataSource.getOwnedSession).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('uses the same safe not-found error for missing sessions and inactive questions', async () => {
    for (const dataSource of [source({ ownedSession: null }), source({ activeQuestion: null })]) {
      await expect(restorePracticeSession(dataSource, {
        userId: 'user-1', sessionId: 'session-1', questionId: 'question-1',
      })).rejects.toMatchObject({ code: 'restore_not_found' });
    }
  });

  it('rejects blank routes, completed sessions, and mismatched question categories', async () => {
    await expect(restorePracticeSession(source(), {
      userId: 'user-1', sessionId: ' ', questionId: 'question-1',
    })).rejects.toMatchObject({ code: 'invalid_route' });

    await expect(restorePracticeSession(source({ ownedSession: { ...session, completed: true } }), {
      userId: 'user-1', sessionId: 'session-1', questionId: 'question-1',
    })).rejects.toMatchObject({ code: 'session_closed' });

    await expect(restorePracticeSession(source({ activeQuestion: { ...question, category: 'nhs' } }), {
      userId: 'user-1', sessionId: 'session-1', questionId: 'question-1',
    })).rejects.toMatchObject({ code: 'restore_mismatch' });
  });

  it('trusts cached practice data only when route, session, and authenticated owner agree', () => {
    expect(ownsCachedPracticeSession({
      authenticatedUserId: 'user-1',
      routeSessionId: 'session-1',
      cachedSession: session,
    })).toBe(true);

    for (const values of [
      { authenticatedUserId: 'user-2', routeSessionId: 'session-1', cachedSession: session },
      { authenticatedUserId: 'user-1', routeSessionId: 'session-2', cachedSession: session },
      { authenticatedUserId: 'user-1', routeSessionId: 'session-1', cachedSession: null },
    ]) {
      expect(ownsCachedPracticeSession(values)).toBe(false);
    }
  });
});
