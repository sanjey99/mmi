import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConfirmAction } from '../../src/components/feedback/ConfirmAction';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { createCandidateMmiApi, type CandidateMmiServerProjection } from '../../src/features/candidateMmi/api';
import { isNormalizedMmiStationEnabled } from '../../src/features/candidateMmi/featureFlag';
import { createNoCaptureMediaPort } from '../../src/features/candidateMmi/mediaPort';
import { createCandidateMmiRunner } from '../../src/features/candidateMmi/runner';
import { supabase } from '../../src/lib/supabase';
import { colors, text } from '../../src/theme';

type CandidateRunner = ReturnType<typeof createCandidateMmiRunner>;
type ClockAnchor = Readonly<{ phaseKey: string; serverNowMs: number; phaseEndsAtMs: number; monotonicStartedAt: number }>;

function monotonicNow(): number {
  return performance.now();
}

function phaseKey(value: CandidateMmiServerProjection): string {
  return `${value.sessionId}:${value.phase}:${value.phaseStartedAt}`;
}

function createClockAnchor(value: CandidateMmiServerProjection): ClockAnchor | null {
  if (value.phaseEndsAt === null) return null;
  const serverNowMs = Date.parse(value.serverNow);
  const phaseEndsAtMs = Date.parse(value.phaseEndsAt);
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(phaseEndsAtMs)) return null;
  return Object.freeze({ phaseKey: phaseKey(value), serverNowMs, phaseEndsAtMs, monotonicStartedAt: monotonicNow() });
}

function secondsRemaining(anchor: ClockAnchor | null): number {
  if (anchor === null) return 0;
  const trustedNowMs = anchor.serverNowMs + (monotonicNow() - anchor.monotonicStartedAt);
  return Math.max(0, Math.ceil((anchor.phaseEndsAtMs - trustedNowMs) / 1_000));
}

function formatSeconds(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export default function CandidateMmiStationScreen() {
  const { sessionId: routeSessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof routeSessionId === 'string' ? routeSessionId : '';
  const runnerRef = useRef<CandidateRunner | null>(null);
  const anchorRef = useRef<ClockAnchor | null>(null);
  const expiringPhaseRef = useRef<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [projection, setProjection] = useState<CandidateMmiServerProjection | null>(null);
  const [tick, setTick] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const runner = useCallback((): CandidateRunner => {
    if (runnerRef.current !== null) return runnerRef.current;
    runnerRef.current = createCandidateMmiRunner(createCandidateMmiApi(supabase), createNoCaptureMediaPort());
    return runnerRef.current;
  }, []);

  const acceptProjection = useCallback((nextProjection: CandidateMmiServerProjection) => {
    anchorRef.current = createClockAnchor(nextProjection);
    expiringPhaseRef.current = null;
    setProjection(nextProjection);
    setTick(0);
  }, []);

  useEffect(() => {
    let active = true;
    const readConfig = async (key: string): Promise<unknown> => {
      const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
      if (error) throw error;
      return data?.value;
    };
    void isNormalizedMmiStationEnabled(readConfig).then(flagEnabled => {
      if (!active) return;
      setEnabled(flagEnabled);
      if (!flagEnabled) router.replace('/(tabs)/practice');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (enabled !== true) return;
    let active = true;
    const openStation = async () => {
      try {
        const nextProjection = sessionId
          ? await runner().restore(sessionId)
          : await runner().start();
        if (!active) return;
        acceptProjection(nextProjection);
        if (!sessionId) {
          router.replace({ pathname: '/practice/mmi-station' as never, params: { sessionId: nextProjection.sessionId } });
        }
      } catch {
        if (active) setErrorMessage('The candidate station is unavailable. Return to practice and try again.');
      }
    };
    void openStation();
    return () => { active = false; };
  }, [acceptProjection, enabled, runner, sessionId]);

  useEffect(() => {
    if (projection?.phaseEndsAt === null || projection === null) return;
    const interval = setInterval(() => setTick(value => value + 1), 250);
    return () => clearInterval(interval);
  }, [projection]);

  const remaining = useMemo(() => {
    void tick;
    return secondsRemaining(anchorRef.current);
  }, [projection, tick]);

  useEffect(() => {
    if (projection === null || remaining !== 0 || projection.phaseEndsAt === null) return;
    const key = phaseKey(projection);
    if (expiringPhaseRef.current === key) return;
    expiringPhaseRef.current = key;
    void runner().expireCurrentPhase().then(acceptProjection).catch(() => {
      setErrorMessage('The candidate station could not advance safely.');
    });
  }, [acceptProjection, projection, remaining, runner]);

  const handleLeave = async () => {
    setLeaving(true);
    setErrorMessage(null);
    try {
      await runner().leave();
      router.replace('/(tabs)/practice');
    } catch {
      setErrorMessage('Leaving the candidate station was not completed. Try again.');
      setLeaving(false);
    }
  };

  if (enabled === null || projection === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <Text style={styles.title}>Opening candidate station</Text>
          {errorMessage ? <InlineNotice title="Station unavailable" message={errorMessage} tone="error" /> : null}
        </View>
      </SafeAreaView>
    );
  }

  if (projection.phase === 'completed' || projection.phase === 'abandoned') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <Text style={styles.eyebrow}>CANDIDATE STATION</Text>
          <Text style={styles.title}>{projection.phase === 'completed' ? 'Station complete' : 'Station closed'}</Text>
          <Button label="Return to practice" onPress={() => router.replace('/(tabs)/practice')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>CANDIDATE STATION · {formatSeconds(remaining)}</Text>
          <TouchableOpacity onPress={() => setLeaveOpen(true)} accessibilityRole="button"><Text style={styles.leave}>Leave</Text></TouchableOpacity>
        </View>
        {errorMessage ? <InlineNotice title="Station unavailable" message={errorMessage} tone="error" /> : null}
        {projection.phase === 'scenario' ? (
          <View style={styles.panel}>
            <Text style={styles.label}>60-second brief</Text>
            <Text style={styles.reading}>{projection.scenarioText}</Text>
          </View>
        ) : projection.phase === 'response' ? (
          <View style={styles.panel}>
            <Text style={styles.label}>Response {projection.promptOrder} · 120-second response</Text>
            <Text style={styles.reading}>{projection.promptText}</Text>
          </View>
        ) : null}
        {leaveOpen ? (
          <ConfirmAction
            title="Leave candidate station?"
            message="The current station will close."
            confirmLabel="Leave station"
            busy={leaving}
            onConfirm={handleLeave}
            onCancel={() => setLeaveOpen(false)}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { flex: 1, padding: 24, gap: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { ...text.labelMd, color: colors.neutral[600] },
  title: { ...text.displayLg, color: colors.primary[900] },
  leave: { ...text.labelMd, color: colors.error },
  panel: { backgroundColor: colors.bg.white, borderWidth: 1, borderColor: colors.bg.tertiary, padding: 20, gap: 12 },
  label: { ...text.headingMd, color: colors.primary[900] },
  reading: { ...text.bodyLg, color: colors.neutral[700] },
});
