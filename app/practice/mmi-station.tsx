import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConfirmAction } from '../../src/components/feedback/ConfirmAction';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { Button } from '../../src/components/ui/Button';
import {
  createCandidateMmiApi,
  type CandidateMmiFeedback,
  type CandidateMmiServerProjection,
} from '../../src/features/candidateMmi/api';
import { createCandidateMmiRunner } from '../../src/features/candidateMmi/runner';
import { createCandidateMmiScoringApi } from '../../src/features/candidateMmi/scoringApi';
import { candidateMmiScoringFailureMessage } from '../../src/features/candidateMmi/scoringSummary';
import { createBrowserSpeechPort } from '../../src/features/candidateMmi/speechPort';
import {
  CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS,
  createTranscriptState,
  reduceTranscript,
  type CandidateMmiTranscriptAction,
  type CandidateMmiTranscriptState,
} from '../../src/features/candidateMmi/transcript';
import type {
  CandidateMmiPromptOrder,
  CandidateMmiSpeechPort,
  CandidateMmiSpeechRecognitionConstructor,
  CandidateMmiSpeechStatus,
} from '../../src/features/candidateMmi/types';
import { supabase } from '../../src/lib/supabase';
import { colors, corridorTypography } from '../../src/theme';

type CandidateApi = ReturnType<typeof createCandidateMmiApi>;
type CandidateRunner = ReturnType<typeof createCandidateMmiRunner>;
type CandidateScoringApi = ReturnType<typeof createCandidateMmiScoringApi>;
type ClockAnchor = Readonly<{
  phaseKey: string;
  serverNowMs: number;
  phaseEndsAtMs: number;
  monotonicStartedAt: number;
}>;
type SpeechHost = typeof globalThis &
  Readonly<{
    SpeechRecognition?: CandidateMmiSpeechRecognitionConstructor;
    webkitSpeechRecognition?: CandidateMmiSpeechRecognitionConstructor;
  }>;

const CHECKPOINT_DEBOUNCE_MS = 2_000;
const FEEDBACK_POLL_MS = 3_000;
const FEEDBACK_POLL_LIMIT_MS = 60_000;
const MMI_PROMPT_ORDERS = Object.freeze([1, 2, 3, 4, 5] as const);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function monotonicNow(): number {
  return performance.now();
}

function phaseKey(value: CandidateMmiServerProjection): string {
  return `${value.sessionId}:${value.phase}:${value.phaseStartedAt}`;
}

function responseIdentity(
  value: CandidateMmiServerProjection | null,
): string | null {
  return value?.phase === 'response'
    ? `${value.sessionId}:${value.promptOrder}:${value.phaseStartedAt}`
    : null;
}

function createClockAnchor(value: CandidateMmiServerProjection): ClockAnchor | null {
  if (value.phaseEndsAt === null) return null;
  const serverNowMs = Date.parse(value.serverNow);
  const phaseEndsAtMs = Date.parse(value.phaseEndsAt);
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(phaseEndsAtMs)) return null;
  return Object.freeze({
    phaseKey: phaseKey(value),
    serverNowMs,
    phaseEndsAtMs,
    monotonicStartedAt: monotonicNow(),
  });
}

function secondsRemaining(anchor: ClockAnchor | null): number {
  if (anchor === null) return 0;
  const trustedNowMs = anchor.serverNowMs + (monotonicNow() - anchor.monotonicStartedAt);
  return Math.max(0, Math.ceil((anchor.phaseEndsAtMs - trustedNowMs) / 1_000));
}

function formatSeconds(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function createFinalizationKey(): string {
  const capability = globalThis.crypto;
  if (typeof capability?.randomUUID !== 'function')
    throw new Error('Secure finalization IDs are unavailable.');
  return capability.randomUUID();
}

function finalizationKeyForResponse(
  sessionId: string,
  promptOrder: CandidateMmiPromptOrder,
  volatileKeys: Map<string, string>,
): string {
  const storageKey = `candidate-mmi-finalization:${sessionId}:${promptOrder}`;
  try {
    const existing = globalThis.sessionStorage?.getItem(storageKey);
    if (existing && UUID_PATTERN.test(existing)) return existing;
    const created = createFinalizationKey();
    globalThis.sessionStorage?.setItem(storageKey, created);
    return created;
  } catch {
    const existing = volatileKeys.get(storageKey);
    if (existing) return existing;
    const created = createFinalizationKey();
    volatileKeys.set(storageKey, created);
    return created;
  }
}

function speechStatusMessage(status: CandidateMmiSpeechStatus): string {
  if (status === 'listening') return 'Listening — live words appear below.';
  if (status === 'restarting') return 'Reconnecting the microphone…';
  if (status === 'unsupported')
    return 'Speech recognition is not supported here. Manual typing remains available.';
  if (status === 'permission_denied')
    return 'Microphone permission was denied. Manual typing remains available.';
  if (status === 'unavailable')
    return 'Microphone transcription is unavailable. Manual typing remains available.';
  return 'Microphone paused. Manual typing remains available.';
}

function feedbackIsTerminal(feedback: readonly CandidateMmiFeedback[]): boolean {
  return feedback.every(
    (item) => item.status !== 'pending' && item.status !== 'in_progress',
  );
}

function FeedbackCard({ item }: Readonly<{ item: CandidateMmiFeedback }>) {
  const assessment = item.assessment;
  return (
    <View style={styles.feedbackCard}>
      <Text style={styles.label}>Response {item.promptOrder}</Text>
      {assessment ? (
        <>
          <Text style={styles.score}>Overall score · {assessment.overallPct}%</Text>
          {assessment.strengths.map((strength) => (
            <Text key={strength} style={styles.feedbackText}>• {strength}</Text>
          ))}
          <Text style={styles.feedbackHeading}>Improvement tip</Text>
          <Text style={styles.feedbackText}>{assessment.improvementTip}</Text>
        </>
      ) : (
        <Text style={styles.feedbackText}>
          {item.status === 'no_response'
            ? 'No saved response was available to score.'
            : item.status === 'pending' || item.status === 'in_progress'
              ? 'Feedback is being prepared…'
              : 'Feedback is unavailable for this response.'}
        </Text>
      )}
    </View>
  );
}

export default function CandidateMmiStationScreen() {
  const { sessionId: routeSessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof routeSessionId === 'string' ? routeSessionId : '';
  const apiRef = useRef<CandidateApi | null>(null);
  const runnerRef = useRef<CandidateRunner | null>(null);
  const scoringRef = useRef<CandidateScoringApi | null>(null);
  const speechPortRef = useRef<CandidateMmiSpeechPort | null>(null);
  const projectionRef = useRef<CandidateMmiServerProjection | null>(null);
  const transcriptRef = useRef<CandidateMmiTranscriptState | null>(null);
  const anchorRef = useRef<ClockAnchor | null>(null);
  const openedSessionRef = useRef<string | null>(null);
  const expiringPhaseRef = useRef<string | null>(null);
  const frozenResponseRef = useRef<string | null>(null);
  const autoStartSpeechRef = useRef<string | null>(null);
  const speechPreparedRef = useRef(false);
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkpointInFlightRef = useRef<Promise<void> | null>(null);
  const checkpointQueuedRef = useRef(false);
  const volatileFinalizationKeysRef = useRef(new Map<string, string>());
  const completedScoringSessionRef = useRef<string | null>(null);
  const [projection, setProjection] = useState<CandidateMmiServerProjection | null>(null);
  const [transcript, setTranscript] = useState<CandidateMmiTranscriptState | null>(null);
  const [feedback, setFeedback] = useState<readonly CandidateMmiFeedback[] | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const [scoringFailureMessage, setScoringFailureMessage] = useState<string | null>(null);
  const [speechStatus, setSpeechStatus] = useState<CandidateMmiSpeechStatus>('idle');
  const [preflightStatus, setPreflightStatus] = useState<CandidateMmiSpeechStatus>('idle');
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [starting, setStarting] = useState(false);
  const [tick, setTick] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [advanceFailed, setAdvanceFailed] = useState(false);
  const [responseAction, setResponseAction] = useState<'submit' | 'skip' | 'timer' | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const api = useCallback((): CandidateApi => {
    if (apiRef.current === null) apiRef.current = createCandidateMmiApi(supabase);
    return apiRef.current;
  }, []);

  const runner = useCallback((): CandidateRunner => {
    if (runnerRef.current === null) runnerRef.current = createCandidateMmiRunner(api());
    return runnerRef.current;
  }, [api]);

  const scoringApi = useCallback((): CandidateScoringApi => {
    if (scoringRef.current === null) {
      scoringRef.current = createCandidateMmiScoringApi((name, options) =>
        supabase.functions.invoke(name, options),
      );
    }
    return scoringRef.current;
  }, []);

  const speechPort = useCallback((): CandidateMmiSpeechPort => {
    if (speechPortRef.current === null) {
      const host = globalThis as SpeechHost;
      speechPortRef.current = createBrowserSpeechPort({
        SpeechRecognition: host.SpeechRecognition,
        webkitSpeechRecognition: host.webkitSpeechRecognition,
      });
    }
    return speechPortRef.current;
  }, []);

  const dispatchTranscript = useCallback((action: CandidateMmiTranscriptAction) => {
    const current = transcriptRef.current;
    if (current === null) return;
    const next = reduceTranscript(current, action);
    transcriptRef.current = next;
    setTranscript(next);
  }, []);

  const acceptProjection = useCallback(
    (nextProjection: CandidateMmiServerProjection, autoStartSpeech = false) => {
      const previousIdentity = responseIdentity(projectionRef.current);
      const nextIdentity = responseIdentity(nextProjection);
      if (previousIdentity && previousIdentity !== nextIdentity)
        void speechPort().stop({ responseIdentity: previousIdentity });
      projectionRef.current = nextProjection;
      anchorRef.current = createClockAnchor(nextProjection);
      expiringPhaseRef.current = null;
      setAdvanceFailed(false);
      setProjection(nextProjection);
      setTick(0);
      if (nextProjection.phase === 'response') {
        const restored = createTranscriptState(
          nextIdentity!,
          nextProjection.draftTranscript,
          nextProjection.draftRevision,
        );
        transcriptRef.current = restored;
        frozenResponseRef.current = null;
        setTranscript(restored);
        setSpeechStatus(speechPort().getCapability().supported ? 'idle' : 'unsupported');
        autoStartSpeechRef.current =
          autoStartSpeech && speechPreparedRef.current ? nextIdentity : null;
      } else {
        transcriptRef.current = null;
        setTranscript(null);
        autoStartSpeechRef.current = null;
      }
    },
    [speechPort],
  );

  const beginSpeech = useCallback(async () => {
    const currentProjection = projectionRef.current;
    if (currentProjection?.phase !== 'response') return;
    const identity = responseIdentity(currentProjection)!;
    if (frozenResponseRef.current === identity) return;
    await speechPort().start({
      responseIdentity: identity,
      onFinalFragment: (value) => {
        if (frozenResponseRef.current === identity) return;
        dispatchTranscript({ type: 'finalFragment', responseIdentity: identity, text: value });
      },
      onInterimText: (value) => {
        if (frozenResponseRef.current === identity) return;
        dispatchTranscript({ type: 'interim', responseIdentity: identity, text: value });
      },
      onStatus: setSpeechStatus,
    });
  }, [dispatchTranscript, speechPort]);

  const flushCheckpoint = useCallback((): Promise<void> => {
    const currentProjection = projectionRef.current;
    const currentTranscript = transcriptRef.current;
    const identity = responseIdentity(currentProjection);
    if (
      currentProjection?.phase !== 'response' ||
      currentTranscript === null ||
      currentTranscript.responseIdentity !== identity ||
      currentTranscript.frozen ||
      !currentTranscript.dirty
    ) return Promise.resolve();
    if (checkpointInFlightRef.current) {
      checkpointQueuedRef.current = true;
      return checkpointInFlightRef.current;
    }
    const textAtRequest = currentTranscript.committedText;
    const revisionAtRequest = currentTranscript.revision + 1;
    const request = runner()
      .checkpoint({ transcript: textAtRequest, revision: revisionAtRequest })
      .then((acknowledgement) => {
        dispatchTranscript({
          type: 'acceptedCheckpoint',
          responseIdentity: identity!,
          text: textAtRequest,
          revision: acknowledgement.draftRevision,
        });
      })
      .catch(() => {
        if (projectionRef.current === currentProjection)
          setErrorMessage('Your latest transcript changes are not saved yet.');
      })
      .finally(() => {
        checkpointInFlightRef.current = null;
        const shouldContinue = checkpointQueuedRef.current;
        checkpointQueuedRef.current = false;
        if (shouldContinue) setTimeout(() => void flushCheckpoint(), 0);
      });
    checkpointInFlightRef.current = request;
    return request;
  }, [dispatchTranscript, runner]);

  useEffect(() => {
    if (!sessionId || openedSessionRef.current === sessionId) return;
    let active = true;
    openedSessionRef.current = sessionId;
    void runner().restore(sessionId)
      .then((nextProjection) => {
        if (active) acceptProjection(nextProjection, false);
      })
      .catch(() => {
        if (!active) return;
        openedSessionRef.current = null;
        setErrorMessage('The MMI station is unavailable. Return to practice and try again.');
      });
    return () => { active = false; };
  }, [acceptProjection, runner, sessionId]);

  useEffect(() => {
    if (projection?.phaseEndsAt === null || projection === null) return;
    const interval = setInterval(() => setTick((value) => value + 1), 250);
    return () => clearInterval(interval);
  }, [projection]);

  const remaining = useMemo(() => {
    void tick;
    return secondsRemaining(anchorRef.current);
  }, [projection, tick]);

  useEffect(() => {
    const identity = responseIdentity(projection);
    if (!identity || autoStartSpeechRef.current !== identity) return;
    autoStartSpeechRef.current = null;
    void beginSpeech();
  }, [beginSpeech, projection]);

  useEffect(() => {
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    if (projection?.phase !== 'response' || transcript === null || transcript.frozen || !transcript.dirty)
      return;
    checkpointTimerRef.current = setTimeout(
      () => void flushCheckpoint(),
      CHECKPOINT_DEBOUNCE_MS,
    );
    return () => {
      if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    };
  }, [flushCheckpoint, projection, transcript]);

  useEffect(() => {
    if (
      projection?.phase !== 'response' ||
      transcript === null ||
      transcript.frozen ||
      !transcript.dirty ||
      remaining <= 0 ||
      remaining > 2
    ) return;
    void flushCheckpoint();
  }, [flushCheckpoint, projection, remaining, transcript]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const flushBeforeThrottle = () => void flushCheckpoint();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushBeforeThrottle();
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushBeforeThrottle);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushBeforeThrottle);
    };
  }, [flushCheckpoint]);

  const completeCurrentResponse = useCallback((submittedTranscript: string, action: 'submit' | 'skip' | 'timer') => {
    const currentProjection = projectionRef.current;
    if (currentProjection?.phase !== 'response') return;
    const key = phaseKey(currentProjection);
    if (expiringPhaseRef.current === key) return;
    expiringPhaseRef.current = key;
    setAdvanceFailed(false);
    setErrorMessage(null);
    setResponseAction(action);
    const identity = responseIdentity(currentProjection)!;
    frozenResponseRef.current = identity;
    dispatchTranscript({ type: 'freeze', responseIdentity: identity });
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    void speechPort().stop({ responseIdentity: identity });
    let finalizationKey: string;
    try {
      finalizationKey = finalizationKeyForResponse(
        currentProjection.sessionId,
        currentProjection.promptOrder,
        volatileFinalizationKeysRef.current,
      );
    } catch {
      expiringPhaseRef.current = null;
      setResponseAction(null);
      setAdvanceFailed(true);
      setErrorMessage('This browser cannot create a secure response identity.');
      return;
    }
    const completion = action === 'timer'
      ? (checkpointInFlightRef.current ?? Promise.resolve())
          .then(() => runner().expireCurrentPhase(finalizationKey))
      : runner().completeCurrentResponse({ transcript: submittedTranscript, finalizationKey });
    void completion
      .then((nextProjection) => acceptProjection(nextProjection, true))
      .catch(() => {
        if (expiringPhaseRef.current === key) expiringPhaseRef.current = null;
        setAdvanceFailed(true);
        setErrorMessage('The MMI station could not advance safely.');
      })
      .finally(() => setResponseAction(null));
  }, [acceptProjection, dispatchTranscript, runner, speechPort]);

  const advanceExpiredPhase = useCallback(() => {
    const currentProjection = projectionRef.current;
    if (currentProjection === null || currentProjection.phaseEndsAt === null) return;
    if (currentProjection.phase === 'response') {
      completeCurrentResponse(transcriptRef.current?.committedText ?? '', 'timer');
      return;
    }
    const key = phaseKey(currentProjection);
    if (expiringPhaseRef.current === key) return;
    expiringPhaseRef.current = key;
    setAdvanceFailed(false);
    setErrorMessage(null);
    void runner().expireCurrentPhase('')
      .then((nextProjection) => acceptProjection(nextProjection, true))
      .catch(() => {
        if (expiringPhaseRef.current === key) expiringPhaseRef.current = null;
        setAdvanceFailed(true);
        setErrorMessage('The MMI station could not advance safely.');
      });
  }, [acceptProjection, completeCurrentResponse, runner]);

  useEffect(() => {
    if (projection === null || remaining !== 0 || projection.phaseEndsAt === null) return;
    advanceExpiredPhase();
  }, [advanceExpiredPhase, projection, remaining]);

  const completedSessionId = projection?.phase === 'completed' ? projection.sessionId : null;

  const scoreCompletedStation = useCallback(async (completedId: string) => {
    if (completedScoringSessionRef.current === completedId) return;
    completedScoringSessionRef.current = completedId;
    setScoringInProgress(true);
    setScoringFailureMessage(null);
    setFeedbackMessage(null);

    let failureMessage: string | null = null;
    try {
      const outcomes = await Promise.allSettled(
        MMI_PROMPT_ORDERS.map((promptOrder) =>
          scoringApi().scoreCandidateResponse(completedId, promptOrder),
        ),
      );
      failureMessage = candidateMmiScoringFailureMessage(outcomes);
      try {
        setFeedback(await api().feedback(completedId));
      } catch {
        failureMessage ??= 'AI scoring is unavailable. Try again.';
      }
    } finally {
      setScoringFailureMessage(failureMessage);
      setScoringInProgress(false);
    }
  }, [api, scoringApi]);

  useEffect(() => {
    if (!completedSessionId) return;
    void scoreCompletedStation(completedSessionId);
  }, [completedSessionId, scoreCompletedStation]);

  useEffect(() => {
    if (!completedSessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const nextFeedback = await api().feedback(completedSessionId);
        if (!active) return;
        setFeedback(nextFeedback);
        if (feedbackIsTerminal(nextFeedback)) {
          setFeedbackMessage(null);
          return;
        }
      } catch {
        if (!active) return;
      }
      if (Date.now() - startedAt >= FEEDBACK_POLL_LIMIT_MS) {
        setFeedbackMessage('Some feedback is still processing. You can return later to view it.');
        return;
      }
      timer = setTimeout(() => void poll(), FEEDBACK_POLL_MS);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, completedSessionId]);

  const retryAiScoring = useCallback(() => {
    if (!completedSessionId || scoringInProgress) return;
    completedScoringSessionRef.current = null;
    void scoreCompletedStation(completedSessionId);
  }, [completedSessionId, scoreCompletedStation, scoringInProgress]);

  useEffect(() => () => {
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    void speechPortRef.current?.abort();
  }, []);

  const testMicrophone = async () => {
    setTestingMicrophone(true);
    setErrorMessage(null);
    try {
      const status = await speechPort().preflight({ onStatus: setPreflightStatus });
      speechPreparedRef.current = status === 'listening';
    } finally {
      setTestingMicrophone(false);
    }
  };

  const startStation = async () => {
    setStarting(true);
    setErrorMessage(null);
    try {
      const nextProjection = await runner().start();
      openedSessionRef.current = nextProjection.sessionId;
      acceptProjection(nextProjection, true);
      router.replace({
        pathname: '/practice/mmi-station' as never,
        params: { sessionId: nextProjection.sessionId },
      });
    } catch {
      setErrorMessage('The MMI station could not start. Try again.');
      setStarting(false);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    setErrorMessage(null);
    await speechPort().abort();
    try {
      await runner().leave();
      router.replace('/(tabs)/practice');
    } catch {
      setErrorMessage('Leaving the MMI station was not completed. Try again.');
      setLeaving(false);
    }
  };

  if (projection === null && !sessionId) {
    const supported = speechPort().getCapability().supported;
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.eyebrow}>11-MINUTE MMI STATION</Text>
          <Text style={styles.title}>Check your setup</Text>
          <View style={styles.panel}>
            <Text style={styles.label}>Browser speech service</Text>
            <Text style={styles.reading}>
              Your browser or platform may send microphone audio to its speech
              provider for transcription. This app does not record or store
              audio. Only the editable transcript is saved for your responses
              and transcript-only feedback.
            </Text>
          </View>
          <Text style={styles.status}>
            {supported
              ? preflightStatus === 'listening'
                ? 'Microphone ready. The station timer has not started.'
                : speechStatusMessage(preflightStatus)
              : speechStatusMessage('unsupported')}
          </Text>
          {errorMessage ? <InlineNotice title="Station unavailable" message={errorMessage} tone="error" /> : null}
          <View style={styles.actions}>
            <Button
              label={testingMicrophone ? 'Testing microphone' : 'Test microphone'}
              onPress={() => void testMicrophone()}
              loading={testingMicrophone}
              disabled={!supported || starting}
              variant="secondary"
              labelStyle={styles.actionLabel}
            />
            <Button
              label={starting ? 'Starting station' : 'Start station'}
              onPress={() => void startStation()}
              loading={starting}
              disabled={testingMicrophone}
              labelStyle={styles.actionLabel}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (projection === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.title}>Restoring MMI station</Text>
          {errorMessage ? <InlineNotice title="Station unavailable" message={errorMessage} tone="error" /> : null}
        </View>
      </SafeAreaView>
    );
  }

  if (projection.phase === 'completed' || projection.phase === 'abandoned') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.eyebrow}>MMI STATION</Text>
          <Text style={styles.title}>
            {projection.phase === 'completed' ? 'Station complete' : 'Station closed'}
          </Text>
          {projection.phase === 'completed' ? (
            <>
              <Text style={styles.status}>Transcript-only feedback · five responses in station order</Text>
              {feedback?.map((item) => <FeedbackCard key={item.promptOrder} item={item} />) ?? (
                <Text style={styles.reading}>Preparing feedback…</Text>
              )}
              {scoringInProgress ? (
                <InlineNotice
                  title="AI evaluation in progress"
                  message="Your completed station is being evaluated."
                  tone="info"
                />
              ) : null}
              {scoringFailureMessage ? (
                <>
                  <InlineNotice
                    title="AI scoring could not complete"
                    message={scoringFailureMessage}
                    tone="error"
                  />
                  <Button
                    label="Retry AI scoring"
                    onPress={retryAiScoring}
                    variant="secondary"
                    labelStyle={styles.actionLabel}
                  />
                </>
              ) : null}
              {feedbackMessage ? <InlineNotice title="Feedback update" message={feedbackMessage} tone="warning" /> : null}
            </>
          ) : null}
          <Button
            label="Return to practice"
            onPress={() => router.replace('/(tabs)/practice')}
            labelStyle={styles.actionLabel}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>MMI STATION</Text>
            <Text style={styles.timer} accessibilityLabel={`${remaining} seconds remaining`}>
              {formatSeconds(remaining)}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setLeaveOpen(true)} accessibilityRole="button">
            <Text style={styles.leave}>Leave</Text>
          </TouchableOpacity>
        </View>
        {errorMessage ? <InlineNotice title="Station update" message={errorMessage} tone="error" /> : null}
        {advanceFailed ? (
          <Button
            label="Retry advance"
            onPress={advanceExpiredPhase}
            variant="secondary"
            labelStyle={styles.actionLabel}
          />
        ) : null}
        {projection.phase === 'scenario' ? (
          <View style={styles.panel}>
            <Text style={styles.label}>60-second brief</Text>
            <Text style={styles.reading}>{projection.scenarioText}</Text>
            <Text style={styles.status}>
              Read only. Your microphone begins with response 1 if your setup test passed.
            </Text>
          </View>
        ) : projection.phase === 'response' ? (
          <>
            <View style={styles.panel}>
              <Text style={styles.label}>
                Response {projection.promptOrder} · 120-second response
              </Text>
              <Text style={styles.reading}>{projection.promptText}</Text>
            </View>
            <View style={styles.transcriptPanel}>
              <View style={styles.transcriptHeader}>
                <Text style={styles.label}>Your live transcript</Text>
                <Text style={styles.count}>
                  {Array.from(transcript?.committedText ?? '').length} / {CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS}
                </Text>
              </View>
              <Text style={styles.status}>{speechStatusMessage(speechStatus)}</Text>
              {speechStatus !== 'listening' ? (
                <Button
                  label="Resume microphone"
                  onPress={() => void beginSpeech()}
                  disabled={!speechPort().getCapability().supported || transcript?.frozen}
                  variant="secondary"
                  small
                  labelStyle={styles.actionLabel}
                />
              ) : null}
              <TextInput
                accessibilityLabel="Your response transcript"
                style={styles.transcriptInput}
                multiline
                value={transcript?.committedText ?? ''}
                onChangeText={(value) => {
                  dispatchTranscript({
                    type: 'manualReplace',
                    responseIdentity: responseIdentity(projection)!,
                    text: value,
                  });
                  if (remaining <= 2) void flushCheckpoint();
                }}
                onBlur={() => void flushCheckpoint()}
                editable={transcript?.frozen !== true && remaining > 0}
                placeholder="Speak, use your device dictation, or type your response here."
                placeholderTextColor={colors.neutral[500]}
                textAlignVertical="top"
              />
              {transcript?.interimText ? (
                <Text style={styles.interim}>Hearing: {transcript.interimText}</Text>
              ) : null}
              <Text style={styles.savedHint}>
                {transcript?.dirty ? 'Saving transcript changes…' : 'Transcript saved.'}
              </Text>
              <View style={styles.responseActions}>
                <Button
                  label="Submit answer now"
                  onPress={() => completeCurrentResponse(
                    transcriptRef.current?.committedText ?? '',
                    'submit',
                  )}
                  loading={responseAction === 'submit'}
                  disabled={responseAction !== null || transcript?.frozen || remaining <= 0}
                  style={styles.responseAction}
                  labelStyle={styles.actionLabel}
                />
                <Button
                  label="Skip question"
                  onPress={() => completeCurrentResponse('', 'skip')}
                  loading={responseAction === 'skip'}
                  disabled={responseAction !== null || transcript?.frozen || remaining <= 0}
                  style={styles.responseAction}
                  labelStyle={styles.actionLabel}
                  variant="secondary"
                />
              </View>
            </View>
          </>
        ) : null}
        {leaveOpen ? (
          <ConfirmAction
            title="Leave MMI station?"
            message="The current station will close."
            confirmLabel="Leave station"
            busy={leaving}
            onConfirm={handleLeave}
            onCancel={() => setLeaveOpen(false)}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  centered: { flex: 1, justifyContent: 'center', padding: 24, gap: 20 },
  content: { padding: 24, gap: 20, flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  actions: { gap: 12 },
  responseActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  responseAction: { flexGrow: 1, minWidth: 220 },
  transcriptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  eyebrow: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.8,
    color: colors.neutral[600],
  },
  title: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 34,
    lineHeight: 42,
    color: colors.primary[900],
  },
  timer: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 40,
    lineHeight: 46,
    color: colors.primary[900],
    marginTop: 4,
  },
  leave: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 17,
    lineHeight: 24,
    color: colors.error,
    paddingVertical: 8,
  },
  panel: { backgroundColor: colors.bg.white, borderWidth: 1, borderColor: colors.bg.tertiary, padding: 20, gap: 12 },
  transcriptPanel: { backgroundColor: colors.bg.white, borderTopWidth: 4, borderColor: colors.teal[400], padding: 20, gap: 12 },
  feedbackCard: { backgroundColor: colors.bg.white, borderLeftWidth: 4, borderColor: colors.teal[400], padding: 20, gap: 10 },
  transcriptInput: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: colors.primary[300],
    backgroundColor: colors.bg.primary,
    padding: 14,
    fontFamily: corridorTypography.reading,
    fontSize: 20,
    lineHeight: 30,
    color: colors.neutral[900],
  },
  label: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 20,
    lineHeight: 28,
    color: colors.primary[900],
  },
  reading: {
    fontFamily: corridorTypography.reading,
    fontSize: 22,
    lineHeight: 32,
    color: colors.neutral[700],
  },
  status: {
    fontFamily: corridorTypography.reading,
    fontSize: 18,
    lineHeight: 27,
    color: colors.neutral[600],
  },
  count: {
    fontFamily: corridorTypography.reading,
    fontSize: 16,
    lineHeight: 22,
    color: colors.neutral[600],
  },
  interim: {
    fontFamily: corridorTypography.reading,
    fontSize: 18,
    lineHeight: 27,
    color: colors.info,
    fontStyle: 'italic',
  },
  savedHint: {
    fontFamily: corridorTypography.reading,
    fontSize: 16,
    lineHeight: 23,
    color: colors.neutral[600],
  },
  score: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 24,
    lineHeight: 32,
    color: colors.primary[900],
  },
  feedbackHeading: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 19,
    lineHeight: 27,
    color: colors.primary[900],
  },
  feedbackText: {
    fontFamily: corridorTypography.reading,
    fontSize: 18,
    lineHeight: 27,
    color: colors.neutral[700],
  },
  actionLabel: {
    fontFamily: corridorTypography.readingMedium,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.2,
    textTransform: 'none',
  },
});
