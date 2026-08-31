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
