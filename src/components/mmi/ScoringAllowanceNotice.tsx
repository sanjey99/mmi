import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button } from '../ui/Button';
import { createCandidateMmiAllowanceApi, describeCandidateMmiAllowance, type CandidateMmiScoringAllowance } from '../../features/candidateMmi/scoringAllowance';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { colors, text } from '../../theme';

type AllowanceState = Readonly<{ accountId: string; value: CandidateMmiScoringAllowance | null; failed: boolean }>;

export function ScoringAllowanceNotice() {
  const accountId = useAuthStore(state => state.session?.user.id);
  const authLoading = useAuthStore(state => state.loading);
  const [snapshot, setSnapshot] = useState<AllowanceState | null>(null);
  const [revision, setRevision] = useState(0);
  const api = useMemo(() => createCandidateMmiAllowanceApi(supabase), []);

  useFocusEffect(useCallback(() => {
    if (authLoading || !accountId) return;
    let active = true;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (active) setSnapshot({ accountId, value: null, failed: false });
      try {
        const value = await api.getAllowance();
        if (!active) return;
        setSnapshot({ accountId, value, failed: false });
        // Anchor the refresh to server time, so device clock drift cannot keep
        // yesterday's counter visible after the UTC allowance resets.
        resetTimer = setTimeout(() => { void load(); }, Date.parse(value.resetsAt) - Date.parse(value.checkedAt) + 1_000);
      } catch {
        if (active) setSnapshot({ accountId, value: null, failed: true });
      }
    };
    void load();
    return () => { active = false; if (resetTimer !== undefined) clearTimeout(resetTimer); };
  }, [accountId, api, authLoading, revision]));

  if (authLoading || !accountId) return null;
  const current = snapshot?.accountId === accountId ? snapshot : null;
  const description = current?.value ? describeCandidateMmiAllowance(current.value) : null;
  const resetLabel = current?.value ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(current.value.resetsAt)) : null;

  return (
    <View style={[styles.card, (description?.warning || current?.failed) && styles.warning]} accessibilityLiveRegion="polite">
      <Text style={styles.eyebrow}>BEFORE YOU START / AI FEEDBACK</Text>
      <Text accessibilityRole="header" style={styles.title}>{description?.title ?? (current?.failed ? 'AI feedback allowance could not be checked' : 'Checking your AI feedback allowance…')}</Text>
      <Text style={styles.body}>{description?.message ?? (current?.failed ? 'You can still practise, but AI feedback may be unavailable. Check again before starting if you need feedback for the whole station.' : 'Practice stays available while we check your remaining feedback.')}</Text>
      {resetLabel ? <Text style={styles.reset}>Daily allowance resets at {resetLabel} in your local time (00:00 UTC).</Text> : null}
      {description || current?.failed ? <Button label="Check allowance again" small variant="secondary" onPress={() => setRevision(value => value + 1)} style={styles.retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderTopWidth: 5, borderColor: colors.teal[600], backgroundColor: colors.bg.white, padding: 20, marginBottom: 24, gap: 8 },
  warning: { borderColor: colors.warning },
  eyebrow: { ...text.labelMd, color: colors.neutral[600] },
  title: { ...text.headingLg, color: colors.primary[900] },
  body: { ...text.bodyMd, color: colors.neutral[700], maxWidth: 760 },
  reset: { ...text.bodySm, color: colors.neutral[600] },
  retry: { alignSelf: 'flex-start', marginTop: 4 },
});
