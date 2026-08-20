import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// @ts-ignore TS5097: Node's native TypeScript runner executes these source files directly.
import { initialMmiState, transition } from '../src/features/mmi/machine.ts';

function feedbackForFirstPrompt() {
  const loading = transition(initialMmiState, { type: 'loadAttempt' });
  const preparing = transition(loading, { type: 'attemptLoaded', expectedPromptCount: 2 });
  const ready = transition(preparing, { type: 'preparationComplete', promptId: 'p1', promptOrder: 1 });
  const recording = transition(ready, { type: 'startRecording' });
  const transcribing = transition(recording, { type: 'recordingStopped' });
  const reviewing = transition(transcribing, { type: 'transcriptReceived' });
  const submitting = transition(reviewing, { type: 'submit' });
  return transition(submitting, { type: 'submissionSucceeded' });
}

describe('MMI practice state machine', () => {
  it('derives feedback progression from immutable prompt-order metadata', () => {
    const feedback = feedbackForFirstPrompt();
    assert.deepEqual(feedback, { status: 'feedback', currentPromptId: 'p1', currentPromptOrder: 1, expectedPromptCount: 2, scoredPromptIds: ['p1'], nextPromptIdentity: null });
    const bound = transition(feedback, { type: 'nextPromptBound', promptId: 'p2', promptOrder: 2 });
    const ready = transition(bound, { type: 'continue' });
    assert.deepEqual(ready, { status: 'readyToRecord', currentPromptId: 'p2', currentPromptOrder: 2, expectedPromptCount: 2, scoredPromptIds: ['p1'] });
    assert.throws(() => transition(feedback, { type: 'nextPromptBound', promptId: 'p3', promptOrder: 3 }), /Invalid MMI transition/);
    assert.throws(() => transition(feedback, { type: 'nextPromptBound', promptId: 'p1', promptOrder: 2 }), /Invalid MMI transition/);
    assert.throws(() => transition(feedback, { type: 'continue' }), /Invalid MMI transition/);
    assert.throws(() => transition(feedback, { type: 'viewSummary' }), /Invalid MMI transition/);
    assert.throws(() => transition(feedback, { type: 'submissionSucceeded', hasNextPrompt: false } as never), /Invalid MMI transition/);
    assert.throws(() => transition(feedback, { type: 'submit' }), /Invalid MMI transition/);
    assert.throws(() => transition(feedback, { type: 'startRecording' }), /Invalid MMI transition/);
  });

  it('allows summary only after the internally-derived final prompt and blocks scored resubmission', () => {
    const feedback = feedbackForFirstPrompt();
    const ready = transition(transition(feedback, { type: 'nextPromptBound', promptId: 'p2', promptOrder: 2 }), { type: 'continue' });
    const finalFeedback = transition(
      transition(transition(transition(ready, { type: 'startRecording' }), { type: 'recordingStopped' }), { type: 'transcriptReceived' }),
      { type: 'submit' },
    );
    const completed = transition(finalFeedback, { type: 'submissionSucceeded' });
    assert.deepEqual(transition(completed, { type: 'viewSummary' }), { status: 'summary', scoredPromptIds: ['p1', 'p2'] });
    assert.throws(() => transition({ status: 'reviewingTranscript', currentPromptId: 'p1', currentPromptOrder: 1, expectedPromptCount: 2, scoredPromptIds: ['p1'] }, { type: 'submit' }), /already scored/i);
  });

  it('captures retry provenance and permits abandoning recovery states without losing scored IDs', () => {
    const loadingFailure = transition(transition(initialMmiState, { type: 'loadAttempt' }), { type: 'networkFailed', message: 'Offline' });
    assert.deepEqual(transition(loadingFailure, { type: 'abandon' }), { status: 'abandoned', scoredPromptIds: [] });
    const feedback = feedbackForFirstPrompt();
    const ready = transition(transition(feedback, { type: 'nextPromptBound', promptId: 'p2', promptOrder: 2 }), { type: 'continue' });
    const transcribing = transition(transition(ready, { type: 'startRecording' }), { type: 'recordingStopped' });
    const transcriptionFailure = transition(transcribing, { type: 'networkFailed', message: 'Offline' });
    assert.deepEqual(transition(transcriptionFailure, { type: 'retry' }), transcribing);
    assert.deepEqual(transition(transcriptionFailure, { type: 'abandon' }), { status: 'abandoned', scoredPromptIds: ['p1'] });
    const submitting = transition(transition(transcribing, { type: 'transcriptReceived' }), { type: 'submit' });
    const scoringFailure = transition(submitting, { type: 'networkFailed', message: 'Offline' });
    assert.deepEqual(transition(scoringFailure, { type: 'retry' }), submitting);
    assert.throws(() => transition(scoringFailure, { type: 'retry', retryState: 'loadingAttempt' } as never), /Invalid MMI event/);
  });
});
