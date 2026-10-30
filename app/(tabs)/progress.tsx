import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { createCandidateMmiApi, type CandidateMmiHistoryItem } from '../../src/features/candidateMmi/api';
import { useAccountFocusedResource } from '../../src/features/candidateMmi/useAccountFocusedResource';
import { useAuthStore } from '../../src/stores/authStore';
import { supabase } from '../../src/lib/supabase';
import { colors, text } from '../../src/theme';

export default function ProgressScreen() {
  const api = useMemo(() => createCandidateMmiApi(supabase), []);
  const { session, profile, loading } = useAuthStore();
  const accountId = !loading && session && profile?.id === session.user.id ? session.user.id : null;
  const record = useAccountFocusedResource<readonly CandidateMmiHistoryItem[]>(accountId, api.history);
  const history = record.value ?? [];
  const unavailable = record.unavailable;
  if (!accountId) return null;
  return <ScreenWrapper onRefresh={record.refresh} refreshing={record.refreshing}>
    <View style={styles.headingRow}><Text style={styles.eyebrow}>REVIEW ROOM</Text><Text style={styles.title}>Progress record</Text><Text style={styles.subtitle}>Only your account’s rubric scores and feedback appear here. Our application and database store no raw audio. The full finalized transcript is deleted immediately after successful scoring; answer excerpts of up to 300 characters per criterion are retained with your feedback. Unresolved transcript text is automatically deleted within 24 hours.</Text></View>
    <Text style={styles.sectionLabel}>RECENT MMI STATIONS</Text>
    <Button label="Refresh progress" small variant="secondary" disabled={record.refreshing} onPress={record.refresh} style={styles.refreshAction} />
    {record.refreshing ? <Text style={styles.emptyText}>Loading your progress record…</Text> : null}
    {unavailable ? <Card><Text style={styles.emptyText}>Your progress record is unavailable right now.</Text></Card> : null}
    {!record.refreshing && !unavailable && history.length === 0 ? <Card style={styles.emptyCard}><Text style={styles.emptyCode}>NO COMPLETED STATIONS</Text><Text style={styles.emptyText}>Complete a practice station to open your rubric progress record.</Text><Button label="Go to practice" onPress={() => router.push('/(tabs)/practice')} style={styles.emptyAction} /></Card> : null}
    {history.map((item) => <Card key={item.sessionId} style={styles.sessionCard}>
      <View style={styles.sessionRow}><View><Text style={styles.date}>{new Date(item.startedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</Text><Text style={styles.scope}>{item.scope === 'target' ? `${item.targetUniversity ?? 'Target'} practice` : 'All-university practice'}</Text></View><Text style={styles.score}>{item.overallPct === null ? item.status.replace('_', ' ').toUpperCase() : `${item.overallPct}%`}</Text></View>
      {item.domainAttainment.length > 0 ? <Text style={styles.domains}>{item.domainAttainment.map((domain) => `${domain.domain}: ${domain.pct}%`).join(' · ')}</Text> : null}
      {item.status === 'completed' || (item.status === 'awaiting_scoring' && item.completedAt !== null) ? <Button label={item.status === 'completed' ? 'View rubric result' : 'View available feedback'} small variant="secondary" onPress={() => router.push({ pathname: '/practice/mmi-station' as never, params: { sessionId: item.sessionId, resultOnly: 'true' } })} /> : null}
    </Card>)}
  </ScreenWrapper>;
}
const styles = StyleSheet.create({
  refreshAction: { alignSelf: 'flex-start', marginBottom: 16 },
  headingRow: { gap: 4, marginBottom: 24 }, eyebrow: { ...text.labelMd, color: colors.neutral[500] }, title: { ...text.displayLg, color: colors.primary[800] }, subtitle: { ...text.bodySm, color: colors.neutral[500], maxWidth: 600 }, sectionLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 9 }, emptyCard: { alignItems: 'flex-start' }, emptyCode: { ...text.labelMd, color: colors.neutral[500], marginBottom: 6 }, emptyText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 }, emptyAction: { marginTop: 16, alignSelf: 'stretch' }, sessionCard: { marginBottom: 12, gap: 12 }, sessionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, date: { ...text.labelMd, color: colors.neutral[500] }, scope: { ...text.bodyMd, color: colors.primary[800], marginTop: 2 }, score: { ...text.headingLg, color: colors.primary[800] }, domains: { ...text.bodySm, color: colors.neutral[600] },
});
