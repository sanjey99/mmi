import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '../../src/components/ui/Card';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { createAdminMmiApi } from '../../src/features/adminMmi/api';
import type { AdminMmiDashboard } from '../../src/features/adminMmi/types';
import { navigateBackOr } from '../../src/lib/navigation';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { colors, layout, text } from '../../src/theme';

const api = createAdminMmiApi(supabase);
const destinations = [
  ['S01', 'Station repository', 'Search, version, publish, archive, and restore complete 11-minute stations.', '/admin/stations'],
  ['P02', 'Panel library', 'Manage imported panel questions outside the 11-minute candidate practice pool.', '/admin/panels'],
  ['A03', 'AI configuration', 'Set a provider, model, compatible endpoint, rates, and write-only key.', '/admin/ai-config'],
  ['U04', 'Usage and costs', 'Inspect known and unavailable per-question scoring costs.', '/admin/usage'],
  ['R05', 'Assessment explorer', 'Audited, structured rubric and cost inspection without answer content.', '/admin/assessments'],
  ['F06', 'Feedback desk', 'Review partner reports where follow-up is permitted.', '/admin/feedback'],
] as const;

export default function AdminDashboard() {
  const profile = useAuthStore((state) => state.profile);
  const [dashboard, setDashboard] = useState<AdminMmiDashboard | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { if (profile && !profile.is_admin) router.replace('/(tabs)'); }, [profile]);
  useEffect(() => { if (profile?.is_admin) void api.getDashboard().then(setDashboard).catch(() => setError(true)); }, [profile?.is_admin]);
  if (!profile?.is_admin) return null;
  const cards = dashboard ? [['PUBLISHED', String(dashboard.stationCounts.published)], ['DRAFTS', String(dashboard.stationCounts.draft)], ['ARCHIVED', String(dashboard.stationCounts.archived)], ['CRITERIA', String(dashboard.contentHealth.criterionCount)], ['KNOWN COST', `$${dashboard.usage.knownCost}`], ['COST UNAVAILABLE', String(dashboard.usage.unknownCostCount)]] : [];
  return <SafeAreaView style={styles.safe}><View style={styles.header}><TouchableOpacity onPress={() => navigateBackOr(router, '/(tabs)')} accessibilityRole="button"><Text style={styles.back}>Back to orient</Text></TouchableOpacity><Text style={styles.headerTitle}>CONTROL DESK</Text><View style={{ width: 112 }} /></View><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><Text style={styles.eyebrow}>AUTHORISED PERSONNEL · MMI OPERATIONS</Text><Text style={styles.title}>Inspectable practice operations</Text><Text style={styles.subtitle}>Manage shared practice content and examine structured scoring health without accessing candidate answer material.</Text>{error ? <InlineNotice title="Dashboard not loaded" message="Check administrator access and connection, then reload this screen." tone="error" /> : null}{!dashboard && !error ? <ActivityIndicator color={colors.teal[400]} style={styles.spinner} /> : null}{dashboard ? <><View style={styles.stats}>{cards.map(([label, value]) => <Card key={label} style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></Card>)}</View><Card variant="teal" style={styles.health}><Text style={styles.healthTitle}>CONTENT AND SCORING HEALTH</Text><Text style={styles.healthCopy}>{dashboard.contentHealth.stationCount} stations · {dashboard.contentHealth.questionCount} questions · {dashboard.contentHealth.invalidStationCount} incomplete · {dashboard.usage.failureCount} scoring failures</Text><Text style={styles.healthCopy}>Active scoring: {dashboard.ai.provider} / {dashboard.ai.model} · {dashboard.ai.isConfigured ? 'key configured' : 'key not configured'}</Text><Text style={styles.healthCopy}>University availability: {dashboard.universityCounts.map((item) => `${item.tag} ${item.count}`).join(' · ') || 'none yet'}</Text></Card></> : null}<View style={styles.rule} />{destinations.map(([code, title, description, destination]) => <TouchableOpacity key={code} onPress={() => router.push(destination)} accessibilityRole="button" accessibilityLabel={`${title}. ${description}`}><Card style={styles.route}><View style={styles.code}><Text style={styles.codeText}>{code}</Text></View><View style={styles.routeCopy}><Text style={styles.routeTitle}>{title}</Text><Text style={styles.routeDescription}>{description}</Text></View><Text style={styles.enter}>ENTER</Text></Card></TouchableOpacity>)}</ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg.primary }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPaddingH, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.primary[800] }, back: { ...text.labelMd, color: colors.primary[800], minWidth: 112, textTransform: 'uppercase' }, headerTitle: { ...text.labelMd, color: colors.primary[800] }, content: { padding: layout.screenPaddingH, paddingBottom: 48, gap: 12 }, eyebrow: { ...text.labelMd, color: colors.neutral[500], marginTop: 12 }, title: { ...text.displayLg, color: colors.primary[800] }, subtitle: { ...text.bodyMd, color: colors.neutral[500], lineHeight: 22, maxWidth: 700 }, spinner: { marginVertical: 36 }, stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, stat: { width: 164, minHeight: 86, padding: 12 }, statLabel: { ...text.labelMd, color: colors.neutral[500] }, statValue: { ...text.headingLg, color: colors.primary[800], marginTop: 5, fontVariant: ['tabular-nums'] }, health: { gap: 5, marginTop: 6 }, healthTitle: { ...text.labelMd, color: colors.teal[600] }, healthCopy: { ...text.bodySm, color: colors.primary[800] }, rule: { height: 8, backgroundColor: colors.teal[400], marginVertical: 12 }, route: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 1, borderColor: colors.primary[800] }, code: { backgroundColor: colors.primary[800], width: 58, height: 58, justifyContent: 'center', alignItems: 'center' }, codeText: { ...text.headingSm, color: colors.bg.white }, routeCopy: { flex: 1 }, routeTitle: { ...text.headingMd, color: colors.primary[800] }, routeDescription: { ...text.bodySm, color: colors.neutral[500], lineHeight: 19 }, enter: { ...text.labelMd, color: colors.neutral[500] } });
