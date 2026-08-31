import {
  CandidateMmiApiError,
  type CandidateMmiServerProjection,
} from './api';
import type {
  CandidateMmiAbortReason,
  CandidateMmiMediaPort,
  CompletedResponseArtifactRef,
} from './types';

type CandidateMmiApi = Readonly<{
  start: () => Promise<CandidateMmiServerProjection>;
  refresh: (sessionId: string) => Promise<CandidateMmiServerProjection>;
  abandon: (sessionId: string) => Promise<void>;
}>;

function responseIdentity(projection: CandidateMmiServerProjection): string | null {
  return projection.phase === 'response'
    ? `${projection.sessionId}:${projection.promptOrder}:${projection.phaseStartedAt}`
    : null;
}

export function createCandidateMmiRunner(api: CandidateMmiApi, media: CandidateMmiMediaPort) {
  let projection: CandidateMmiServerProjection | null = null;
  let preparedSessionIds: ReadonlySet<string> = new Set<string>();
  let begunResponseIdentity: string | null = null;
  let finishedResponseIdentity: string | null = null;
  let finishedResponseArtifact: CompletedResponseArtifactRef | null = null;
  let inFlightResponseFinish: Promise<CompletedResponseArtifactRef | null> | null = null;
  let mediaAborted = false;

  async function beginCurrentResponse(nextProjection: CandidateMmiServerProjection): Promise<void> {
    if (nextProjection.phase !== 'response') return;
    const identity = responseIdentity(nextProjection)!;
    if (begunResponseIdentity === identity) return;
    if (!preparedSessionIds.has(nextProjection.sessionId)) {
      await media.prepare({ sessionId: nextProjection.sessionId });
      preparedSessionIds = new Set([...preparedSessionIds, nextProjection.sessionId]);
    }
    await media.beginResponse({
      sessionId: nextProjection.sessionId,
      promptOrder: nextProjection.promptOrder,
    });
    begunResponseIdentity = identity;
    finishedResponseIdentity = null;
    finishedResponseArtifact = null;
  }

  async function acceptProjection(nextProjection: CandidateMmiServerProjection): Promise<CandidateMmiServerProjection> {
    projection = nextProjection;
    await beginCurrentResponse(nextProjection);
    return nextProjection;
  }

  async function abortMediaOnce(reason: CandidateMmiAbortReason): Promise<void> {
    if (mediaAborted || projection === null) return;
    mediaAborted = true;
    await media.abort({ sessionId: projection.sessionId, reason });
  }

  async function finishCurrentResponseOnce(): Promise<CompletedResponseArtifactRef | null> {
    if (projection?.phase !== 'response') return null;
    const identity = responseIdentity(projection)!;
    if (finishedResponseIdentity === identity) return finishedResponseArtifact;
    if (inFlightResponseFinish !== null) return inFlightResponseFinish;
    inFlightResponseFinish = media.finishResponse().then(artifact => {
      finishedResponseIdentity = identity;
      finishedResponseArtifact = artifact;
      return artifact;
    }).finally(() => {
      inFlightResponseFinish = null;
    });
    return inFlightResponseFinish;
  }

  async function settleExpiredResponseBestEffort(expiredResponseIdentity: string): Promise<void> {
    try {
      await finishCurrentResponseOnce();
    } catch {
      const currentResponseIdentity = projection === null ? null : responseIdentity(projection);
      if (currentResponseIdentity !== expiredResponseIdentity) return;
      finishedResponseIdentity = expiredResponseIdentity;
      finishedResponseArtifact = null;
    }
  }

  async function refresh(): Promise<CandidateMmiServerProjection> {
    if (projection === null) throw new CandidateMmiApiError('invalid_request');
    try {
      const currentProjection = projection;
      const nextProjection = await api.refresh(currentProjection.sessionId);
      if (currentProjection.phase === 'response'
        && responseIdentity(currentProjection) !== responseIdentity(nextProjection)) {
        await finishCurrentResponseOnce();
      }
      return await acceptProjection(nextProjection);
    } catch (error) {
      if (error instanceof CandidateMmiApiError && error.kind === 'feature_disabled') {
        await abortMediaOnce('feature_disabled');
      }
      throw error;
    }
  }

  return Object.freeze({
    start: async (): Promise<CandidateMmiServerProjection> => acceptProjection(await api.start()),
    restore: async (sessionId: string): Promise<CandidateMmiServerProjection> => acceptProjection(await api.refresh(sessionId)),
    refresh,
    expireCurrentPhase: async (): Promise<CandidateMmiServerProjection> => {
      const expiredResponseIdentity = projection === null ? null : responseIdentity(projection);
      if (expiredResponseIdentity !== null) await settleExpiredResponseBestEffort(expiredResponseIdentity);
      return refresh();
    },
    finishCurrentResponse: finishCurrentResponseOnce,
    leave: async (): Promise<void> => {
      if (projection === null) throw new CandidateMmiApiError('invalid_request');
      await abortMediaOnce('leave');
      await api.abandon(projection.sessionId);
    },
  });
}
