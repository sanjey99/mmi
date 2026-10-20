import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { createLatestRequestGate } from '../../src/features/adminMmi/latestRequestGate';
import { createOperationsApi, OperationsApiError } from '../../src/features/operations/api';
import type { OperationsDashboard, RuntimeArea, RuntimeKind } from '../../src/features/operations/types';
import { navigateBackOr } from '../../src/lib/navigation';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { colors, layout, text } from '../../src/theme';

const api = createOperationsApi(supabase);
const kindLabels: Record<RuntimeKind, string> = { runtime_error: 'App errors', unhandled_rejection: 'Unfinished actions', render_error: 'Screen errors' };
const areaLabels: Record<RuntimeArea, string> = { login: 'Sign in', account_link: 'Account links', onboarding: 'Orientation', practice: 'Practice', feedback: 'Feedback', progress: 'Progress', profile: 'Profile', admin: 'Administration', other: 'Other screens' };
const number = (value: number) => value.toLocaleString('en-GB');
const utcTime = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const duration = (value: number | null) => value === null ? 'No calls yet' : `${(value / 1000).toFixed(2)}s`;

function Metric({ label, value, detail }: Readonly<{ label: string; value: string; detail?: string }>) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text>{detail ? <Text style={styles.detail}>{detail}</Text> : null}</View>;
}

function Section({ code, title, description, children }: Readonly<{ code: string; title: string; description?: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View style={styles.sectionHeading}><Text style={styles.sectionCode}>{code}</Text><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text></View>{description ? <Text style={styles.description}>{description}</Text> : null}{children}</View>;
}

function DailyTrend({ daily }: Readonly<{ daily: OperationsDashboard['daily'] }>) {
  const maximum = Math.max(1, ...daily.map((day) => Math.max(day.stationsStarted, day.stationsFinished)));
  return <View style={styles.trend}>
    <View style={styles.legend}><Text style={styles.legendText}>■ Started</Text><Text style={styles.finishedLegend}>■ Finished</Text><Text style={styles.detail}>Today is partial · UTC</Text></View>
    {daily.map((day) => <View key={day.date} style={styles.trendRow} accessibilityLabel={`${day.date} UTC: ${day.stationsStarted} stations started, ${day.stationsFinished} finished`}>
      <Text style={styles.trendDate}>{new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })}</Text>
      <View style={styles.bars}><View style={styles.barTrack}><View style={[styles.startedBar, { width: `${day.stationsStarted / maximum * 100}%` }]} /></View><View style={styles.barTrack}><View style={[styles.finishedBar, { width: `${day.stationsFinished / maximum * 100}%` }]} /></View></View>
      <Text style={styles.trendValue}>{number(day.stationsStarted)} / {number(day.stationsFinished)}</Text>
    </View>)}
  </View>;
}

export default function OperationsScreen() {
  const profile = useAuthStore((state) => state.profile);
  const [testersOnly, setTestersOnly] = useState(true);
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(createLatestRequestGate());
  const load = useCallback(() => {
    if (!profile?.is_admin) return;
    const request = gate.current.begin();
    setLoading(true);
    setDashboard(null);
    setError(null);
    void api.getOperationsDashboard(testersOnly).then((next) => {
      if (gate.current.isCurrent(request)) setDashboard(next);
    }).catch((reason: unknown) => {
      if (gate.current.isCurrent(request)) setError(reason instanceof OperationsApiError ? reason.message : 'Operations are unavailable right now. Please try again.');
    }).finally(() => { if (gate.current.isCurrent(request)) setLoading(false); });
  }, [profile?.id, profile?.is_admin, testersOnly]);
  useEffect(() => {
    load();
    return () => { gate.current.begin(); };
  }, [load]);
  if (!profile?.is_admin) return null;

  const failureCount = dashboard ? dashboard.scoring.providerFailures + dashboard.scoring.invalidResponses + dashboard.scoring.persistenceFailures : 0;
  const retentionUnhealthy = dashboard !== null && (!dashboard.retention.jobActive || dashboard.retention.heartbeatAgeSeconds === null || dashboard.retention.heartbeatAgeSeconds > 900 || dashboard.retention.overdueResponses > 0 || dashboard.retention.overdueDrafts > 0);
  const recentFailureSpike = dashboard !== null && dashboard.scoring.recentFailures >= 3 && dashboard.scoring.recentFailures / Math.max(1, dashboard.scoring.recentCalls) >= 0.25;
  const empty = dashboard !== null && dashboard.activity.stationsStarted === 0 && dashboard.activity.accountsCreated === 0 && dashboard.activity.reportsSubmitted === 0 && dashboard.scoring.providerCalls === 0 && dashboard.runtime.recordedErrors === 0;

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><TouchableOpacity onPress={() => navigateBackOr(router, '/admin')} accessibilityRole="button"><Text style={styles.back}>Back to admin</Text></TouchableOpacity><Text style={styles.headerLabel}>OPERATIONS / 07</Text></View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}><Text style={styles.eyebrow}>PRACTICE · RELIABILITY · RETENTION</Text><Text accessibilityRole="header" style={styles.title}>Operations overview</Text><Text style={styles.subtitle}>Seven UTC days of aggregate activity, with current scoring and retention checks.</Text></View>
      <View style={styles.controls}><View style={styles.cohorts} accessibilityLabel="Account cohort"><TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: testersOnly }} onPress={() => setTestersOnly(true)} style={[styles.cohort, testersOnly && styles.cohortSelected]}><Text style={styles.cohortText}>Testers only</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: !testersOnly }} onPress={() => setTestersOnly(false)} style={[styles.cohort, !testersOnly && styles.cohortSelected]}><Text style={styles.cohortText}>All accounts</Text></TouchableOpacity></View><Button label="Refresh dashboard" small variant="secondary" disabled={loading} onPress={load} /></View>
      <Text style={styles.detail}>Testers exclude administrator accounts. Retention checks always cover all accounts.</Text>
      {loading ? <View style={styles.loading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.teal[600]} accessibilityLabel="Loading operations" /><Text style={styles.description}>Loading the latest aggregates…</Text></View> : null}
      {error ? <View style={styles.error}><InlineNotice title="Operations not loaded" message={error} tone="error" /><Button label="Try again" variant="secondary" small onPress={load} /></View> : null}
      {dashboard ? <>
        <View style={styles.period}><Text style={styles.periodText}>{utcTime(dashboard.periodStart)} – {utcTime(dashboard.periodEnd)} UTC</Text><Text style={styles.detail}>Checked {utcTime(dashboard.checkedAt)} UTC · {dashboard.cohort === 'testers' ? 'Testers only' : 'All accounts'}</Text></View>
        {!dashboard.scoring.isConfigured ? <InlineNotice title="Scoring setup needs attention" message="The default scoring provider key or token rates are missing. Review the AI settings before scoring." tone="error" /> : null}
        {retentionUnhealthy ? <InlineNotice title="Retention needs attention" message={!dashboard.retention.jobActive ? 'The scheduled cleanup job is inactive.' : dashboard.retention.heartbeatAgeSeconds === null ? 'No completed cleanup run has been recorded.' : dashboard.retention.heartbeatAgeSeconds > 900 ? 'No cleanup run has completed in the last 15 minutes.' : 'Saved text has passed its retention deadline. Review the global retention checks below.'} tone="error" /> : null}
        {dashboard.scoring.stalledClaims > 0 ? <InlineNotice title="Scoring needs attention" message={`Scoring claims past their lease deadline: ${number(dashboard.scoring.stalledClaims)}.`} tone="warning" /> : null}
        {recentFailureSpike ? <InlineNotice title="Recent scoring failures increased" message={`${number(dashboard.scoring.recentFailures)} of ${number(dashboard.scoring.recentCalls)} attempts failed in the last 15 minutes.`} tone="warning" /> : null}
        {empty ? <InlineNotice title="No activity recorded in this period" message="The selected cohort has no new accounts, practice activity, scoring attempts, reports, or recorded app errors in these seven UTC days." tone="info" /> : null}
        <Section code="01" title="Practice activity" description="Finished stations have five finalized responses. Skipped answers count as finalized responses.">
          <View style={styles.metrics}><Metric label="Practising accounts" value={number(dashboard.activity.practisingUsers)} detail="Distinct accounts that started a station" /><Metric label="Stations started" value={number(dashboard.activity.stationsStarted)} /><Metric label="Stations finished" value={number(dashboard.activity.stationsFinished)} /><Metric label="Stations abandoned" value={number(dashboard.activity.stationsAbandoned)} /><Metric label="New accounts" value={number(dashboard.activity.accountsCreated)} /><Metric label="Reports submitted" value={number(dashboard.activity.reportsSubmitted)} /></View>
          <DailyTrend daily={dashboard.daily} />
        </Section>
        <Section code="02" title="Scoring and cost" description="Provider attempts include retries. Current response counts describe distinct answers across all time for the selected cohort.">
          <View style={styles.metrics}><Metric label="Default scoring setup" value={dashboard.scoring.isConfigured ? 'Configured' : 'Missing'} detail="Checks the stored default provider key and rates. No live provider call is made." /></View>
          <View style={styles.metrics}><Metric label="Provider attempts" value={number(dashboard.scoring.providerCalls)} detail={`${number(failureCount)} failed attempts`} /><Metric label="Known cost · USD" value={`$${dashboard.scoring.knownCostUsd}`} detail="Total excludes attempts with unavailable cost" /><Metric label="Cost unavailable" value={number(dashboard.scoring.unknownCostCalls)} detail="Attempts with missing pricing information" /><Metric label="Average provider time" value={duration(dashboard.scoring.averageLatencyMs)} /><Metric label="95th percentile time" value={duration(dashboard.scoring.p95LatencyMs)} /><Metric label="Awaiting scoring" value={number(dashboard.scoring.pendingResponses)} detail="Current responses, across all time" /><Metric label="Failed responses" value={number(dashboard.scoring.failedResponses)} detail="Current responses, across all time" /><Metric label="Feedback expired" value={number(dashboard.scoring.expiredResponses)} detail="Current responses, across all time" /></View>
          <View style={styles.breakdown}><Text style={styles.description}>Attempt failures in this period</Text><Text style={styles.detail}>Provider failures {number(dashboard.scoring.providerFailures)} · Invalid results {number(dashboard.scoring.invalidResponses)} · Persistence failures {number(dashboard.scoring.persistenceFailures)}</Text><Text style={styles.detail}>Last 15 minutes: {number(dashboard.scoring.recentCalls)} attempts · {number(dashboard.scoring.recentFailures)} failures</Text></View>
        </Section>
        <Section code="03" title="App errors" description="Coarse categories only. These counts contain no error messages, URLs, candidate answers, or account identifiers.">
          <View style={styles.metrics}><Metric label="Recorded errors" value={number(dashboard.runtime.recordedErrors)} /><Metric label="Affected accounts" value={number(dashboard.runtime.affectedAccounts)} /><Metric label="Recent affected accounts" value={number(dashboard.runtime.recentAffectedAccounts)} detail="Last 15 minutes" /><Metric label="Reporting limit reached" value={number(dashboard.runtime.limitedAccounts)} detail="Accounts that reached the hourly reporting cap" /></View>
          <View style={styles.runtimeGroups}><View style={styles.runtimeGroup}>{dashboard.runtime.byKind.map((row) => <View key={row.kind} style={styles.categoryRow}><Text style={styles.categoryLabel}>{kindLabels[row.kind]}</Text><Text style={styles.categoryCount}>{number(row.count)}</Text></View>)}</View><View style={styles.runtimeGroup}>{dashboard.runtime.byArea.map((row) => <View key={row.area} style={styles.categoryRow}><Text style={styles.categoryLabel}>{areaLabels[row.area]}</Text><Text style={styles.categoryCount}>{number(row.count)}</Text></View>)}</View></View>
        </Section>
        <Section code="04" title="Global retention checks" description="These checks always include tester and administrator accounts, regardless of the selected cohort.">
          <View style={styles.metrics}><Metric label="Cleanup schedule" value={dashboard.retention.jobActive ? 'Active' : 'Inactive'} /><Metric label="Last completed run" value={dashboard.retention.lastCompletedAt === null ? 'Not recorded' : `${utcTime(dashboard.retention.lastCompletedAt)} UTC`} /><Metric label="Overdue responses" value={number(dashboard.retention.overdueResponses)} /><Metric label="Overdue drafts" value={number(dashboard.retention.overdueDrafts)} /><Metric label="Stalled scoring claims" value={number(dashboard.scoring.stalledClaims)} detail="Selected cohort; current across all time" /></View>
        </Section>
        <Section code="05" title="Daily record" description="UTC dates; today contains activity only up to the checked time. Scroll horizontally to view every column.">
          <ScrollView horizontal><View style={styles.table}><View style={styles.tableRow}>{['UTC date', 'Accounts', 'Started', 'Finished', 'Attempts', 'Provider failed', 'Known USD', 'Unpriced', 'App errors'].map((label) => <Text key={label} style={[styles.cell, styles.tableHead, label === 'Known USD' && styles.costCell]}>{label}</Text>)}</View>{dashboard.daily.map((day) => <View key={day.date} style={styles.tableRow}>{[day.date, number(day.practisingUsers), number(day.stationsStarted), number(day.stationsFinished), number(day.providerCalls), number(day.providerFailures), day.knownCostUsd, number(day.unknownCostCalls), number(day.runtimeErrors)].map((value, index) => <Text key={index} style={[styles.cell, index === 6 && styles.costCell]}>{value}</Text>)}</View>)}</View></ScrollView>
        </Section>
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: layout.screenPaddingH, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.primary[800] },
  back: { ...text.labelMd, color: colors.primary[800], paddingVertical: 4 }, headerLabel: { ...text.labelMd, color: colors.neutral[600] },
  content: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: layout.screenPaddingH, paddingBottom: 64, gap: 16 },
  hero: { borderBottomWidth: 8, borderBottomColor: colors.teal[400], paddingVertical: 12, paddingBottom: 22 },
  eyebrow: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 }, title: { ...text.displayLg, color: colors.primary[900] }, subtitle: { ...text.bodyMd, color: colors.neutral[600], marginTop: 8, maxWidth: 700, lineHeight: 24 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, cohorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cohort: { borderWidth: 1, borderColor: colors.primary[300], paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.bg.white }, cohortSelected: { backgroundColor: colors.teal[400], borderColor: colors.primary[800] }, cohortText: { ...text.labelMd, color: colors.primary[900] },
  detail: { ...text.bodySm, color: colors.neutral[600], lineHeight: 21 }, description: { ...text.bodyMd, color: colors.neutral[700], lineHeight: 24 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 32 }, error: { gap: 12 },
  period: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.primary[200], paddingVertical: 12, gap: 4 }, periodText: { ...text.labelMd, color: colors.primary[800] },
  section: { gap: 14, marginTop: 12 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, sectionCode: { ...text.headingMd, color: colors.primary[900], backgroundColor: colors.teal[400], paddingHorizontal: 10, paddingVertical: 6 }, sectionTitle: { ...text.headingLg, color: colors.primary[900], flex: 1 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { flexGrow: 1, flexBasis: 190, minWidth: 140, backgroundColor: colors.bg.white, borderWidth: 1, borderColor: colors.primary[200], padding: 16, gap: 7 }, metricLabel: { ...text.labelMd, color: colors.neutral[600] }, metricValue: { ...text.headingLg, color: colors.primary[900], fontVariant: ['tabular-nums'] },
  trend: { backgroundColor: colors.bg.white, borderWidth: 1, borderColor: colors.primary[200], padding: 16, gap: 12 }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 6 }, legendText: { ...text.labelMd, color: colors.teal[600] }, finishedLegend: { ...text.labelMd, color: colors.primary[800] }, trendRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, trendDate: { ...text.bodySm, color: colors.neutral[700], width: 56 }, bars: { flex: 1, gap: 4 }, barTrack: { height: 10, backgroundColor: colors.bg.secondary }, startedBar: { height: 10, backgroundColor: colors.teal[400] }, finishedBar: { height: 10, backgroundColor: colors.primary[800] }, trendValue: { ...text.bodySm, color: colors.primary[800], width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] },
  breakdown: { backgroundColor: colors.bg.secondary, padding: 14, gap: 6 }, runtimeGroups: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, runtimeGroup: { flex: 1, minWidth: 240, backgroundColor: colors.bg.white, padding: 16, borderWidth: 1, borderColor: colors.primary[200] }, categoryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, borderBottomColor: colors.bg.tertiary, paddingVertical: 8 }, categoryLabel: { ...text.bodyMd, color: colors.neutral[700] }, categoryCount: { ...text.bodyMd, color: colors.primary[800], fontVariant: ['tabular-nums'] },
  table: { minWidth: 1000 }, tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.primary[200] }, cell: { ...text.bodySm, color: colors.neutral[700], width: 104, paddingVertical: 12, paddingHorizontal: 8, fontVariant: ['tabular-nums'] }, costCell: { width: 136 }, tableHead: { ...text.labelMd, color: colors.primary[900], backgroundColor: colors.bg.secondary },
});
