import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Button } from '../../src/components/ui/Button';
import { ScoringAllowanceNotice } from '../../src/components/mmi/ScoringAllowanceNotice';
import { createCandidateMmiApi, type CandidateMmiPracticeOptions } from '../../src/features/candidateMmi/api';
import { useAccountFocusedResource } from '../../src/features/candidateMmi/useAccountFocusedResource';
import { useAuthStore } from '../../src/stores/authStore';
import { supabase } from '../../src/lib/supabase';
import { colors, text } from '../../src/theme';

export default function PracticeScreen() {
  const { session, profile, loading } = useAuthStore();
  const accountId = !loading && session && profile?.id === session.user.id ? session.user.id : null;
  const api = useMemo(() => createCandidateMmiApi(supabase), []);
  const targetUniversity = profile?.university_target;
  const loadOptions = useCallback(() => api.practiceOptions(), [api, targetUniversity]);
  const options = useAccountFocusedResource<CandidateMmiPracticeOptions>(accountId, loadOptions);
  const value = options.value;
  const targetEnabled = value !== null && value.targetUniversity !== null && value.targetCount > 0;
  const open = (scope: 'target' | 'all') => router.push({ pathname: '/practice/mmi-station' as never, params: { scope } });
  if (!accountId) return null;
  return (
    <ScreenWrapper onRefresh={options.refresh} refreshing={options.refreshing}>
      <Text style={styles.routeLabel}>02 / PRACTISE</Text>
      <Text style={styles.title}>MMI practice</Text>
      <Text style={styles.sub}>Choose a complete 11-minute MMI station. Every station has a one-minute brief and five two-minute answers.</Text>
      <ScoringAllowanceNotice />
      {options.refreshing ? <Text style={styles.notice} accessibilityLiveRegion="polite">Loading practice options…</Text> : null}
      {options.unavailable ? <View style={styles.detailCard} accessibilityLiveRegion="polite"><Text style={styles.notice}>Practice options are unavailable right now. Please try again.</Text><Button label="Retry practice options" small variant="secondary" onPress={options.refresh} /></View> : null}
      {value ? <>
      <View style={styles.stationCard}>
        <Text style={styles.stationNumber}>01</Text>
        <View style={styles.stationCopy}><Text style={styles.stationTitle}>{value.targetUniversity ?? 'Your university'} practice</Text><Text style={styles.stationDescription}>{value.targetCount} complete 11-minute stations</Text>{value.targetUniversity === null ? <Text style={styles.notice}>Add a university target in your profile to unlock this pool.</Text> : null}</View>
        <Button label="Practise" small disabled={!targetEnabled} onPress={() => open('target')} />
      </View>
      <View style={styles.stationCard}>
        <Text style={styles.stationNumber}>02</Text>
        <View style={styles.stationCopy}><Text style={styles.stationTitle}>All-university practice</Text><Text style={styles.stationDescription}>{value.allCount} complete 11-minute stations</Text></View>
        <Button label="Practise" small disabled={value.allCount === 0} onPress={() => open('all')} />
      </View>
      </> : null}
      <View style={styles.detailCard}><Text style={styles.detailTitle}>How it works</Text><Text style={styles.detailText}>1. Read the scenario for 60 seconds.</Text><Text style={styles.detailText}>2. Answer five questions in order.</Text><Text style={styles.detailText}>3. Review five-level criterion scores, weighted marks, and evidence from your answer after the station.</Text></View>
    </ScreenWrapper>
  );
}
const styles = StyleSheet.create({
  routeLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 }, title: { ...text.displayLg, color: colors.primary[900] }, sub: { ...text.bodyLg, color: colors.neutral[600], marginTop: 6, marginBottom: 24, maxWidth: 680 }, stationCard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: colors.teal[400], backgroundColor: colors.bg.white }, stationNumber: { ...text.displayLg, color: colors.primary[900], fontVariant: ['tabular-nums'] }, stationCopy: { flex: 1 }, stationTitle: { ...text.headingLg, color: colors.primary[900] }, stationDescription: { ...text.bodyMd, color: colors.neutral[700], marginTop: 4 }, notice: { ...text.bodySm, color: colors.neutral[600], marginTop: 8 }, detailCard: { marginTop: 10, padding: 20, gap: 8, borderWidth: 1, borderColor: colors.bg.tertiary, backgroundColor: colors.bg.white }, detailTitle: { ...text.headingMd, color: colors.primary[900], marginBottom: 2 }, detailText: { ...text.bodyMd, color: colors.neutral[700] },
});
