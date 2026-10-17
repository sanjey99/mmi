import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { createAdminMmiApi } from '../../src/features/adminMmi/api';
import type { AdminMmiAssessmentDetail, AdminMmiAssessmentPurpose } from '../../src/features/adminMmi/types';
import { criterionMarks, criterionPerformanceLevel, formatRubricMark, MMI_PERFORMANCE_LABELS } from '../../src/features/mmi/rubricPerformance';
import { navigateBackOr } from '../../src/lib/navigation';
import { supabase } from '../../src/lib/supabase';
import { colors, layout, text } from '../../src/theme';

const api = createAdminMmiApi(supabase);
const allowed = new Set<AdminMmiAssessmentPurpose>(['scoring_review', 'support', 'cost_review', 'quality_audit']);
export default function AssessmentScreen() {
  const { responseId, purpose } = useLocalSearchParams<{ responseId?: string; purpose?: string }>(); const [assessment, setAssessment] = useState<AdminMmiAssessmentDetail | null>(null); const [error, setError] = useState(false);
  useEffect(() => { if (!responseId || !purpose || !allowed.has(purpose as AdminMmiAssessmentPurpose)) { setError(true); return; } void api.getAssessment(responseId, purpose as AdminMmiAssessmentPurpose).then(setAssessment).catch(() => setError(true)); }, [responseId, purpose]);
  return <SafeAreaView style={styles.safe}><View style={styles.header}><TouchableOpacity onPress={() => navigateBackOr(router, '/admin/assessments')} accessibilityRole="button"><Text style={styles.back}>Back to explorer</Text></TouchableOpacity><Text style={styles.headerTitle}>STRUCTURED RESULT</Text><View style={{ width: 120 }} /></View><ScrollView contentContainerStyle={styles.content}>{error ? <InlineNotice title="Structured result unavailable" message="Choose an audit purpose from the explorer and try again." tone="error" /> : null}{!assessment && !error ? <ActivityIndicator color={colors.teal[400]} style={{ margin: 30 }} /> : null}{assessment ? <><Text style={styles.title}>Rubric checklist</Text><Text style={styles.sub}>{assessment.userDisplayName} · {assessment.stationId} · Question {assessment.promptOrder} · {assessment.questionScorePct}%</Text><Text style={styles.meta}>{assessment.provider ?? 'No provider'} / {assessment.model ?? 'No model'} · {assessment.outcome ?? 'No outcome'} · {assessment.estimatedCost === null ? 'Cost unavailable' : `$${assessment.estimatedCost}`} · {assessment.latencyMs ?? '—'}ms</Text><Text style={styles.meta}>{assessment.inputTokens ?? '—'} input · {assessment.cachedInputTokens ?? '—'} cached input · {assessment.outputTokens ?? '—'} output</Text><Text style={styles.meta}>Finalized {assessment.finalizedAt} · Scored {assessment.scoredAt}</Text>{assessment.criteria.map((criterion) => {
      const graduated = 'performanceLevel' in criterion;
      const level = criterionPerformanceLevel(criterion);
      return <View key={criterion.criterionId} accessibilityRole={graduated ? undefined : 'checkbox'} accessibilityState={graduated ? undefined : { checked: level === 4 }} style={styles.criterion}>
        {!graduated ? <Text style={[styles.box, level === 4 ? styles.achieved : styles.missed]}>{level === 4 ? '✓' : '□'}</Text> : null}
        <View style={{ flex: 1 }}><Text style={styles.bullet}>{criterion.bulletText}{graduated ? `: ${formatRubricMark(criterionMarks(criterion))}/${formatRubricMark(criterion.weightPct)}` : ''}</Text><Text style={styles.meta}>{criterion.domain ? `${criterion.domain} · ` : ''}{graduated ? MMI_PERFORMANCE_LABELS[level] : `${formatRubricMark(criterion.weightPct)}%`}</Text></View>
      </View>;
    })}<Text style={styles.audit}>Audit record {assessment.accessAuditId} · purpose: {purpose}</Text></> : null}</ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg.primary }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingHorizontal: layout.screenPaddingH, borderBottomWidth: 1, borderBottomColor: colors.primary[800] }, back: { ...text.labelMd, color: colors.primary[800], minWidth: 120 }, headerTitle: { ...text.labelMd, color: colors.primary[800] }, content: { padding: layout.screenPaddingH, paddingBottom: 48, gap: 12 }, title: { ...text.displayLg, color: colors.primary[800] }, sub: { ...text.bodyMd, color: colors.neutral[700] }, meta: { ...text.bodySm, color: colors.neutral[600] }, criterion: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: colors.bg.white, borderWidth: 1, borderColor: colors.primary[300] }, box: { fontSize: 22, lineHeight: 28 }, achieved: { color: colors.success }, missed: { color: colors.neutral[500] }, bullet: { ...text.bodyMd, color: colors.primary[800] }, audit: { ...text.caption, color: colors.neutral[500], marginTop: 12 } });
