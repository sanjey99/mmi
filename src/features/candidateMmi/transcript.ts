export const CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS = 12_000;

export type CandidateMmiTranscriptState = Readonly<{
  responseIdentity: string;
  committedText: string;
  interimText: string;
  checkpointedText: string;
  dirty: boolean;
  frozen: boolean;
}>;

export type CandidateMmiTranscriptAction =
  | Readonly<{ type: 'restore'; responseIdentity: string; text: string }>
  | Readonly<{ type: 'manualReplace'; responseIdentity: string; text: string }>
  | Readonly<{ type: 'finalFragment'; responseIdentity: string; text: string }>
  | Readonly<{ type: 'interim'; responseIdentity: string; text: string }>
  | Readonly<{ type: 'acceptedCheckpoint'; responseIdentity: string }>
  | Readonly<{ type: 'freeze'; responseIdentity: string }>;

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function capCodePoints(value: string): string {
  return Array.from(value).slice(0, CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS).join('');
}

function canonicalText(value: string): string {
  return capCodePoints(normalizeText(value));
}

function withState(state: CandidateMmiTranscriptState, changes: Partial<CandidateMmiTranscriptState>): CandidateMmiTranscriptState {
  return Object.freeze({ ...state, ...changes });
}

export function createTranscriptState(responseIdentity: string, restoredText = ''): CandidateMmiTranscriptState {
  const committedText = canonicalText(restoredText);
  return Object.freeze({
    responseIdentity,
    committedText,
    interimText: '',
    checkpointedText: committedText,
    dirty: false,
    frozen: false,
  });
}

export function reduceTranscript(
  state: CandidateMmiTranscriptState,
  action: CandidateMmiTranscriptAction,
): CandidateMmiTranscriptState {
  if (action.responseIdentity !== state.responseIdentity || state.frozen) return state;
  if (action.type === 'restore') return createTranscriptState(state.responseIdentity, action.text);
  if (action.type === 'manualReplace') {
    const committedText = canonicalText(action.text);
    return withState(state, { committedText, interimText: '', dirty: committedText !== state.checkpointedText });
  }
  if (action.type === 'finalFragment') {
    const fragment = canonicalText(action.text);
    if (!fragment) return state;
    const committedText = canonicalText([state.committedText, fragment].filter(Boolean).join(' '));
    return withState(state, { committedText, interimText: '', dirty: committedText !== state.checkpointedText });
  }
  if (action.type === 'interim') return withState(state, { interimText: canonicalText(action.text) });
  if (action.type === 'acceptedCheckpoint') return withState(state, { checkpointedText: state.committedText, dirty: false });
  return withState(state, { interimText: '', frozen: true });
}
