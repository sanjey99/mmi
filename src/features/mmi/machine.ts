type PromptState = { currentPromptId: string; currentPromptOrder: number; expectedPromptCount: number; scoredPromptIds: readonly string[] };
type NextPromptIdentity = { promptId: string; promptOrder: number };
type ReadyStatus = 'readyToRecord' | 'recording' | 'transcribing' | 'reviewingTranscript' | 'submitting';
type ActiveState = ({ status: ReadyStatus } & PromptState) | ({ status: 'feedback' } & PromptState & { nextPromptIdentity: NextPromptIdentity | null });
export type MmiState =
  | { status: 'idle' } | { status: 'loadingAttempt' } | { status: 'preparing'; expectedPromptCount: number }
  | ActiveState | { status: 'summary'; scoredPromptIds: readonly string[] }
  | { status: 'recoverableError'; retryState: RetryableState; message: string } | { status: 'abandoned'; scoredPromptIds: readonly string[] };
type RetryableState = { status: 'loadingAttempt' } | ({ status: 'transcribing' } & PromptState) | ({ status: 'submitting' } & PromptState);
export type MmiEvent =
  | { type: 'loadAttempt' } | { type: 'attemptLoaded'; expectedPromptCount: number }
  | { type: 'preparationComplete'; promptId: string; promptOrder: number }
  | { type: 'startRecording' } | { type: 'recordingStopped' } | { type: 'transcriptReceived' } | { type: 'submit' }
  | { type: 'submissionSucceeded' } | { type: 'nextPromptBound'; promptId: string; promptOrder: number } | { type: 'continue' }
  | { type: 'viewSummary' } | { type: 'networkFailed'; message: string } | { type: 'retry' } | { type: 'abandon' };

export const initialMmiState: MmiState = Object.freeze({ status: 'idle' });
function invalid(state: MmiState, event: unknown): never { throw new Error(`Invalid MMI transition: ${state.status} -> ${typeof event === 'object' && event !== null && 'type' in event ? String((event as { type: unknown }).type) : 'unknown'}`); }
function assertKeys(event: MmiEvent, keys: readonly string[]): void { const actual = Object.keys(event).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error('Invalid MMI event'); }
function copy(ids: readonly string[]): string[] { return Array.from(ids); }
function isValidPromptMetadata(promptId: string, promptOrder: number, expectedPromptCount: number): boolean { return promptId.trim() !== '' && Number.isInteger(promptOrder) && promptOrder >= 1 && promptOrder <= expectedPromptCount; }
function readyState(status: ReadyStatus, state: PromptState): ActiveState { return { status, currentPromptId: state.currentPromptId, currentPromptOrder: state.currentPromptOrder, expectedPromptCount: state.expectedPromptCount, scoredPromptIds: copy(state.scoredPromptIds) } as ActiveState; }

export function transition(state: MmiState, event: MmiEvent): MmiState {
  if (event.type === 'abandon') {
    assertKeys(event, ['type']);
    if (state.status === 'idle' || state.status === 'summary' || state.status === 'abandoned') return invalid(state, event);
    if (state.status === 'recoverableError') return { status: 'abandoned', scoredPromptIds: state.retryState.status === 'loadingAttempt' ? [] : copy(state.retryState.scoredPromptIds) };
    return { status: 'abandoned', scoredPromptIds: 'scoredPromptIds' in state ? copy(state.scoredPromptIds) : [] };
  }
  if (event.type === 'networkFailed') {
    assertKeys(event, ['type', 'message']);
    if (event.message.trim() === '' || (state.status !== 'loadingAttempt' && state.status !== 'transcribing' && state.status !== 'submitting')) return invalid(state, event);
    const retryState: RetryableState = state.status === 'loadingAttempt' ? { status: 'loadingAttempt' } : readyState(state.status, state) as RetryableState;
    return { status: 'recoverableError', retryState, message: event.message };
  }
  if (event.type === 'retry') {
    assertKeys(event, ['type']);
    if (state.status !== 'recoverableError') return invalid(state, event);
    return state.retryState.status === 'loadingAttempt' ? { status: 'loadingAttempt' } : readyState(state.retryState.status, state.retryState);
  }
  if (state.status === 'idle' && event.type === 'loadAttempt') { assertKeys(event, ['type']); return { status: 'loadingAttempt' }; }
  if (state.status === 'loadingAttempt' && event.type === 'attemptLoaded') { assertKeys(event, ['type', 'expectedPromptCount']); if (!Number.isInteger(event.expectedPromptCount) || event.expectedPromptCount < 1) throw new Error('Invalid MMI event'); return { status: 'preparing', expectedPromptCount: event.expectedPromptCount }; }
  if (state.status === 'preparing' && event.type === 'preparationComplete') { assertKeys(event, ['type', 'promptId', 'promptOrder']); if (!isValidPromptMetadata(event.promptId, event.promptOrder, state.expectedPromptCount) || event.promptOrder !== 1) return invalid(state, event); return { status: 'readyToRecord', currentPromptId: event.promptId, currentPromptOrder: event.promptOrder, expectedPromptCount: state.expectedPromptCount, scoredPromptIds: [] }; }
  if (state.status === 'readyToRecord' && event.type === 'startRecording') { assertKeys(event, ['type']); return readyState('recording', state); }
  if (state.status === 'recording' && event.type === 'recordingStopped') { assertKeys(event, ['type']); return readyState('transcribing', state); }
  if (state.status === 'transcribing' && event.type === 'transcriptReceived') { assertKeys(event, ['type']); return readyState('reviewingTranscript', state); }
  if (state.status === 'reviewingTranscript' && event.type === 'submit') { assertKeys(event, ['type']); if (state.scoredPromptIds.includes(state.currentPromptId)) throw new Error('An already scored prompt cannot be resubmitted'); return readyState('submitting', state); }
  if (state.status === 'submitting' && event.type === 'submissionSucceeded') { assertKeys(event, ['type']); if (state.scoredPromptIds.includes(state.currentPromptId)) throw new Error('An already scored prompt cannot be resubmitted'); return { status: 'feedback', currentPromptId: state.currentPromptId, currentPromptOrder: state.currentPromptOrder, expectedPromptCount: state.expectedPromptCount, scoredPromptIds: [...state.scoredPromptIds, state.currentPromptId], nextPromptIdentity: null }; }
  if (state.status === 'feedback' && event.type === 'nextPromptBound') { assertKeys(event, ['type', 'promptId', 'promptOrder']); if (state.currentPromptOrder >= state.expectedPromptCount || state.nextPromptIdentity !== null || !isValidPromptMetadata(event.promptId, event.promptOrder, state.expectedPromptCount) || event.promptOrder !== state.currentPromptOrder + 1 || state.scoredPromptIds.includes(event.promptId)) return invalid(state, event); return { status: 'feedback', currentPromptId: state.currentPromptId, currentPromptOrder: state.currentPromptOrder, expectedPromptCount: state.expectedPromptCount, scoredPromptIds: copy(state.scoredPromptIds), nextPromptIdentity: { promptId: event.promptId, promptOrder: event.promptOrder } }; }
  if (state.status === 'feedback' && event.type === 'continue') { assertKeys(event, ['type']); if (state.nextPromptIdentity === null) return invalid(state, event); return { status: 'readyToRecord', currentPromptId: state.nextPromptIdentity.promptId, currentPromptOrder: state.nextPromptIdentity.promptOrder, expectedPromptCount: state.expectedPromptCount, scoredPromptIds: copy(state.scoredPromptIds) }; }
  if (state.status === 'feedback' && event.type === 'viewSummary') { assertKeys(event, ['type']); if (state.currentPromptOrder !== state.expectedPromptCount || state.nextPromptIdentity !== null) return invalid(state, event); return { status: 'summary', scoredPromptIds: copy(state.scoredPromptIds) }; }
  return invalid(state, event);
}
