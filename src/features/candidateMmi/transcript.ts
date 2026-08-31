export const CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS = 12_000;

export type CandidateMmiTranscriptState = Readonly<{
  responseIdentity: string;
  committedText: string;
  interimText: string;
  checkpointedText: string;
  revision: number;
  dirty: boolean;
  frozen: boolean;
}>;

export type CandidateMmiTranscriptAction =
  | Readonly<{ type: 'restore'; responseIdentity: string; text: string; revision: number }>
  | Readonly<{ type: 'manualReplace'; responseIdentity: string; text: string }>
  | Readonly<{ type: 'finalFragment'; responseIdentity: string; text: string }>
  | Readonly<{ type: 'interim'; responseIdentity: string; text: string }>
  | Readonly<{ type: 'acceptedCheckpoint'; responseIdentity: string; text: string; revision: number }>
  | Readonly<{ type: 'freeze'; responseIdentity: string }>;

function normalizeRecognitionText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function capCodePoints(value: string): string {
  return Array.from(value).slice(0, CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS).join('');
}

function withState(state: CandidateMmiTranscriptState, changes: Partial<CandidateMmiTranscriptState>): CandidateMmiTranscriptState {
  return Object.freeze({ ...state, ...changes });
}

export function createTranscriptState(responseIdentity: string, restoredText = '', revision = 0): CandidateMmiTranscriptState {
  const committedText = capCodePoints(restoredText);
  return Object.freeze({
    responseIdentity,
    committedText,
    interimText: '',
    checkpointedText: committedText,
    revision,
    dirty: false,
    frozen: false,
  });
}

export function reduceTranscript(
  state: CandidateMmiTranscriptState,
  action: CandidateMmiTranscriptAction,
): CandidateMmiTranscriptState {
  if (action.responseIdentity !== state.responseIdentity) return state;
  if (action.type === 'restore') return createTranscriptState(state.responseIdentity, action.text, action.revision);
  if (state.frozen) return state;
  if (action.type === 'manualReplace') {
    const committedText = capCodePoints(action.text);
    return withState(state, { committedText, interimText: '', dirty: committedText !== state.checkpointedText });
  }
  if (action.type === 'finalFragment') {
    const fragment = normalizeRecognitionText(action.text);
    if (!fragment) return state;
    const committedText = capCodePoints(state.committedText ? `${state.committedText} ${fragment}` : fragment);
    return withState(state, { committedText, interimText: '', dirty: committedText !== state.checkpointedText });
  }
  if (action.type === 'interim') return withState(state, { interimText: normalizeRecognitionText(action.text) });
  if (action.type === 'acceptedCheckpoint') {
    if (action.revision <= state.revision) return state;
    const checkpointedText = capCodePoints(action.text);
    return withState(state, { checkpointedText, revision: action.revision, dirty: state.committedText !== checkpointedText });
  }
  return withState(state, { interimText: '', frozen: true });
}
