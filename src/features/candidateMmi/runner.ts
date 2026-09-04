import {
  CandidateMmiApiError,
  type CandidateMmiCheckpoint,
  type CandidateMmiFinalization,
  type CandidateMmiServerProjection,
} from './api';
import type { CandidateMmiPromptOrder } from './types';

type CandidateMmiApi = Readonly<{
  start: () => Promise<CandidateMmiServerProjection>;
  refresh: (sessionId: string) => Promise<CandidateMmiServerProjection>;
  checkpoint: (
    sessionId: string,
    promptOrder: CandidateMmiPromptOrder,
    transcript: string,
    revision: number,
  ) => Promise<CandidateMmiCheckpoint>;
  finalize: (
    sessionId: string,
    promptOrder: CandidateMmiPromptOrder,
    finalizationKey: string,
  ) => Promise<CandidateMmiFinalization>;
  abandon: (sessionId: string) => Promise<void>;
}>;
type ResponseState = Readonly<{
  identity: string;
  revision: number;
  transcript: string;
  accepted: Promise<CandidateMmiCheckpoint>;
  latestRevision: number;
  latestTranscript: string;
}>;
type CheckpointInput = Readonly<{ transcript: string; revision: number }>;
type CompletionInput = Readonly<{
  transcript: string;
  finalizationKey: string;
}>;

function responseIdentity(
  projection: CandidateMmiServerProjection,
): string | null {
  return projection.phase === 'response'
    ? `${projection.sessionId}:${projection.promptOrder}:${projection.phaseStartedAt}`
    : null;
}
function checkpointIdentity(response: string, input: CheckpointInput): string {
  return `${response}:${input.revision}:${input.transcript}`;
}

export function createCandidateMmiRunner(api: CandidateMmiApi) {
  let projection: CandidateMmiServerProjection | null = null;
  let responseState: ResponseState | null = null;
  let inFlightCheckpoints: ReadonlyMap<
    string,
    Promise<CandidateMmiCheckpoint>
  > = new Map();
  let inFlightFinalizations: ReadonlyMap<
    string,
    Promise<CandidateMmiServerProjection>
  > = new Map();
  let inFlightCompletions: ReadonlyMap<
    string,
    Promise<CandidateMmiServerProjection>
  > = new Map();
  let leavePromise: Promise<void> | null = null;

  function acceptProjection(
    nextProjection: CandidateMmiServerProjection,
  ): CandidateMmiServerProjection {
    projection = nextProjection;
    if (nextProjection.phase !== 'response') {
      responseState = null;
      inFlightCheckpoints = new Map();
      return nextProjection;
    }
    const identity = responseIdentity(nextProjection)!;
    const accepted = Promise.resolve(
      Object.freeze({
        sessionId: nextProjection.sessionId,
        promptOrder: nextProjection.promptOrder,
        draftRevision: nextProjection.draftRevision,
        acceptedAt: nextProjection.serverNow,
      }),
    );
    responseState = Object.freeze({
      identity,
      revision: nextProjection.draftRevision,
      transcript: nextProjection.draftTranscript,
      accepted,
      latestRevision: nextProjection.draftRevision,
      latestTranscript: nextProjection.draftTranscript,
    });
    inFlightCheckpoints = new Map();
    return nextProjection;
  }

  async function refresh(): Promise<CandidateMmiServerProjection> {
    if (projection === null) throw new CandidateMmiApiError('invalid_request');
    const currentProjection = projection;
    const nextProjection = await api.refresh(currentProjection.sessionId);
    if (projection !== currentProjection) return projection;
    return acceptProjection(nextProjection);
  }

  function checkpoint(input: CheckpointInput): Promise<CandidateMmiCheckpoint> {
    if (projection?.phase !== 'response' || responseState === null)
      return Promise.reject(new CandidateMmiApiError('response_closed'));
    const stateAtRequest = responseState;
    if (
      input.revision === stateAtRequest.revision &&
      input.transcript === stateAtRequest.transcript
    )
      return stateAtRequest.accepted;
    const key = checkpointIdentity(stateAtRequest.identity, input);
    const existing = inFlightCheckpoints.get(key);
    if (existing !== undefined) return existing;
    responseState = Object.freeze({
      ...stateAtRequest,
      latestRevision: input.revision,
      latestTranscript: input.transcript,
    });
    const promise = api
      .checkpoint(
        projection.sessionId,
        projection.promptOrder,
        input.transcript,
        input.revision,
      )
      .then((acknowledgement) => {
        if (
          responseState?.identity === stateAtRequest.identity &&
          responseState.latestRevision === input.revision &&
          responseState.latestTranscript === input.transcript
        ) {
          responseState = Object.freeze({
            identity: stateAtRequest.identity,
            revision: acknowledgement.draftRevision,
            transcript: input.transcript,
            accepted: Promise.resolve(acknowledgement),
            latestRevision: acknowledgement.draftRevision,
            latestTranscript: input.transcript,
          });
        }
        return acknowledgement;
      })
      .finally(() => {
        const current = inFlightCheckpoints.get(key);
        if (current === promise) {
          const next = new Map(inFlightCheckpoints);
          next.delete(key);
          inFlightCheckpoints = next;
        }
      });
    inFlightCheckpoints = new Map(inFlightCheckpoints).set(key, promise);
    return promise;
  }

  function expireCurrentPhase(
    finalizationKey: string,
  ): Promise<CandidateMmiServerProjection> {
    if (projection === null)
      return Promise.reject(new CandidateMmiApiError('invalid_request'));
    if (projection.phase !== 'response') return refresh();
    const currentProjection = projection;
    const identity = responseIdentity(currentProjection)!;
    const key = `${identity}:${finalizationKey}`;
    const existing = inFlightFinalizations.get(key);
    if (existing !== undefined) return existing;
    const promise = api
      .finalize(
        currentProjection.sessionId,
        currentProjection.promptOrder,
        finalizationKey,
      )
      .then(async () => {
        if (
          projection !== currentProjection ||
          responseIdentity(projection) !== identity
        )
          return projection!;
        return refresh();
      })
      .finally(() => {
        const current = inFlightFinalizations.get(key);
        if (current === promise) {
          const next = new Map(inFlightFinalizations);
          next.delete(key);
          inFlightFinalizations = next;
        }
      });
    inFlightFinalizations = new Map(inFlightFinalizations).set(key, promise);
    return promise;
  }

  function completeCurrentResponse(
    input: CompletionInput,
  ): Promise<CandidateMmiServerProjection> {
    if (projection?.phase !== 'response' || responseState === null)
      return Promise.reject(new CandidateMmiApiError('response_closed'));
    const currentProjection = projection;
    const identity = responseIdentity(currentProjection)!;
    const key = `${identity}:${input.finalizationKey}:${input.transcript}`;
    const existing = inFlightCompletions.get(key);
    if (existing !== undefined) return existing;

    const promise = (async () => {
      await Promise.all(inFlightCheckpoints.values());
      if (
        projection !== currentProjection ||
        responseIdentity(projection) !== identity ||
        responseState === null
      ) {
        throw new CandidateMmiApiError('response_closed');
      }
      if (responseState.transcript !== input.transcript) {
        await checkpoint({
          transcript: input.transcript,
          revision: Math.max(
            responseState.revision,
            responseState.latestRevision,
          ) + 1,
        });
      }
      return expireCurrentPhase(input.finalizationKey);
    })().finally(() => {
      const current = inFlightCompletions.get(key);
      if (current === promise) {
        const next = new Map(inFlightCompletions);
        next.delete(key);
        inFlightCompletions = next;
      }
    });
    inFlightCompletions = new Map(inFlightCompletions).set(key, promise);
    return promise;
  }

  return Object.freeze({
    start: async (): Promise<CandidateMmiServerProjection> =>
      acceptProjection(await api.start()),
    restore: async (sessionId: string): Promise<CandidateMmiServerProjection> =>
      acceptProjection(await api.refresh(sessionId)),
    refresh,
    checkpoint,
    expireCurrentPhase,
    completeCurrentResponse,
    leave: (): Promise<void> => {
      if (projection === null)
        return Promise.reject(new CandidateMmiApiError('invalid_request'));
      if (leavePromise === null)
        leavePromise = api.abandon(projection.sessionId);
      return leavePromise;
    },
  });
}
