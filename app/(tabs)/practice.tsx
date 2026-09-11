import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Button } from '../../src/components/ui/Button';
import { createCandidateMmiApi, type CandidateMmiPracticeOptions } from '../../src/features/candidateMmi/api';
import { supabase } from '../../src/lib/supabase';
import { colors, text } from '../../src/theme';

const fallbackOptions: CandidateMmiPracticeOptions = Object.freeze({
  targetUniversity: null, targetTag: null, targetCount: 0, allCount: 0,
});

export default function PracticeScreen() {
  const [options, setOptions] = useState<CandidateMmiPracticeOptions | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const api = useMemo(() => createCandidateMmiApi(supabase), []);
  useEffect(() => {
    let active = true;
    void api.practiceOptions().then((next) => { if (active) setOptions(next); }).catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [api]);
  const value = options ?? fallbackOptions;
  const targetEnabled = value.targetUniversity !== null && value.targetCount > 0;
  const open = (scope: 'target' | 'all') => router.push({ pathname: '/practice/mmi-station' as never, params: { scope } });
  return (
    <ScreenWrapper>
      <Text style={styles.routeLabel}>02 / PRACTISE</Text>
      <Text style={styles.title}>MMI practice</Text>
      <Text style={styles.sub}>Choose a complete 11-minute MMI station. Every station has a one-minute brief and five two-minute answers.</Text>
      <View style={styles.stationCard}>
        <Text style={styles.stationNumber}>01</Text>
        <View style={styles.stationCopy}><Text style={styles.stationTitle}>{value.targetUniversity ?? 'Your university'} practice</Text><Text style={styles.stationDescription}>{value.targetCount} complete 11-minute stations</Text>{value.targetUniversity === null ? <Text style={styles.notice}>Add a university target in your profile to unlock this pool.</Text> : null}</View>
        <Button label="Practise" small disabled={!targetEnabled || unavailable || options === null} onPress={() => open('target')} />
      </View>
      <View style={styles.stationCard}>
        <Text style={styles.stationNumber}>02</Text>
        <View style={styles.stationCopy}><Text style={styles.stationTitle}>All-university practice</Text><Text style={styles.stationDescription}>{value.allCount} complete 11-minute stations</Text></View>
        <Button label="Practise" small disabled={unavailable || options === null || value.allCount === 0} onPress={() => open('all')} />
      </View>
      {unavailable ? <Text style={styles.notice}>Practice options are unavailable right now. Please try again.</Text> : null}
      <View style={styles.detailCard}><Text style={styles.detailTitle}>How it works</Text><Text style={styles.detailText}>1. Read the scenario for 60 seconds.</Text><Text style={styles.detailText}>2. Answer five questions in order.</Text><Text style={styles.detailText}>3. Review equal-weight rubric checkboxes after the station.</Text></View>
    </ScreenWrapper>
  );
}
const styles = StyleSheet.create({
  routeLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 }, title: { ...text.displayLg, color: colors.primary[900] }, sub: { ...text.bodyLg, color: colors.neutral[600], marginTop: 6, marginBottom: 24, maxWidth: 680 }, stationCard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: colors.teal[400], backgroundColor: colors.bg.white }, stationNumber: { ...text.displayLg, color: colors.primary[900], fontVariant: ['tabular-nums'] }, stationCopy: { flex: 1 }, stationTitle: { ...text.headingLg, color: colors.primary[900] }, stationDescription: { ...text.bodyMd, color: colors.neutral[700], marginTop: 4 }, notice: { ...text.bodySm, color: colors.neutral[600], marginTop: 8 }, detailCard: { marginTop: 10, padding: 20, gap: 8, borderWidth: 1, borderColor: colors.bg.tertiary, backgroundColor: colors.bg.white }, detailTitle: { ...text.headingMd, color: colors.primary[900], marginBottom: 2 }, detailText: { ...text.bodyMd, color: colors.neutral[700] },
});
