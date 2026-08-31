export type CandidateMmiPromptOrder = 1 | 2 | 3 | 4 | 5;

declare const completedResponseArtifactBrand: unique symbol;

export type CompletedResponseArtifactRef = string & Readonly<{
  [completedResponseArtifactBrand]: 'CompletedResponseArtifactRef';
}>;

export type CandidateMmiPhaseProjection = Readonly<{
  kind: 'scenario' | 'response' | 'completed';
  promptOrder: CandidateMmiPromptOrder | null;
  phaseStartedAt: Date;
  phaseEndsAt: Date | null;
}>;

export type CandidateMmiAbortReason = 'leave' | 'expired' | 'feature_disabled';

export interface CandidateMmiMediaPort {
  prepare(input: Readonly<{ sessionId: string }>): Promise<void>;
  beginResponse(input: Readonly<{ sessionId: string; promptOrder: CandidateMmiPromptOrder }>): Promise<void>;
  finishResponse(): Promise<CompletedResponseArtifactRef | null>;
  abort(input: Readonly<{ sessionId: string; reason: CandidateMmiAbortReason }>): Promise<void>;
}

export type CandidateMmiSpeechStatus =
  | 'idle'
  | 'listening'
  | 'restarting'
  | 'unsupported'
  | 'permission_denied'
  | 'unavailable';

export type CandidateMmiSpeechCapability = Readonly<{
  supported: boolean;
  implementation: 'speech_recognition' | 'webkit_speech_recognition' | 'none';
}>;

export type CandidateMmiSpeechCallbacks = Readonly<{
  onFinalFragment: (text: string) => void;
  onInterimText: (text: string) => void;
  onStatus: (status: CandidateMmiSpeechStatus) => void;
}>;

export interface CandidateMmiSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: Readonly<{ transcript: string }>;
}

export interface CandidateMmiSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<CandidateMmiSpeechRecognitionResult>;
}

export interface CandidateMmiSpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Readonly<{ error: string }>) => void) | null;
  onresult: ((event: CandidateMmiSpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

export type CandidateMmiSpeechRecognitionConstructor = new () => CandidateMmiSpeechRecognitionInstance;

export interface CandidateMmiSpeechPort {
  getCapability(): CandidateMmiSpeechCapability;
  start(input: Readonly<{ responseIdentity: string }> & CandidateMmiSpeechCallbacks): Promise<void>;
  stop(input: Readonly<{ responseIdentity: string }>): Promise<void>;
  preflight(input: Readonly<{ onStatus: (status: CandidateMmiSpeechStatus) => void }>): Promise<CandidateMmiSpeechStatus>;
  abort(): Promise<void>;
}
