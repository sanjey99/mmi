import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { ConfirmAction } from '../../src/components/feedback/ConfirmAction';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { FloatingInput as Input } from '../../src/components/ui/Input';
import { AdminMmiApiError, createAdminMmiApi } from '../../src/features/adminMmi/api';
import type { AdminMmiContentStatus, AdminMmiStationDraft } from '../../src/features/adminMmi/types';
import { addDraftCriterion, addDraftQuestion, createStationDraft, remapUnsavedStationDraft } from '../../src/features/adminMmi/stationDraftIds';
import { validateStationDraft } from '../../src/features/adminMmi/validation';
import { navigateBackOr } from '../../src/lib/navigation';
import { supabase } from '../../src/lib/supabase';
import { colors, layout, text } from '../../src/theme';

const api = createAdminMmiApi(supabase);
const reordered = <T extends { order: number }>(items: readonly T[], order: number, direction: -1 | 1) => {
  const next = [...items].sort((left, right) => left.order - right.order);
  const from = next.findIndex((item) => item.order === order);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return items;
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next.map((item, index) => ({ ...item, order: index + 1 }));
};

export default function StationEditor() {
  const { stationId } = useLocalSearchParams<{ stationId?: string }>();
  const [draft, setDraft] = useState<AdminMmiStationDraft>(createStationDraft);
  const [savedDraft, setSavedDraft] = useState<AdminMmiStationDraft>(createStationDraft);
  const [status, setStatus] = useState<AdminMmiContentStatus>('draft');
  const [loading, setLoading] = useState(Boolean(stationId));
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<'save' | 'published' | 'draft' | 'archived' | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string; tone: 'error' | 'success' | 'warning' } | null>(null);

  useEffect(() => {
    if (!stationId) return;
    void api.getStation(stationId)
      .then((result) => { setDraft(result.station); setSavedDraft(result.station); setStatus(result.status); })
      .catch(() => setNotice({ title: 'Station not loaded', message: 'Check your access or return to the repository.', tone: 'error' }))
      .finally(() => setLoading(false));
  }, [stationId]);

  const validation = useMemo(() => validateStationDraft(draft, 'draft'), [draft]);
  const isPublished = status === 'published';
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const canChangeId = draft.expectedVersion === null && !isPublished;

  const edit = (updater: (current: AdminMmiStationDraft) => AdminMmiStationDraft) => {
    setDraft((current) => isPublished ? current : updater(current));
  };
  const update = <K extends keyof AdminMmiStationDraft>(key: K, value: AdminMmiStationDraft[K]) => {
    if (key === 'stationId') {
      if (!canChangeId) return;
      setDraft((current) => isPublished ? current : remapUnsavedStationDraft(current, String(value)));
      return;
    }
    edit((current) => ({ ...current, [key]: value }));
  };
  const updateQuestion = (order: number, field: 'questionText' | 'modelAnswerCached', value: string) => edit((current) => ({
    ...current,
    questions: current.questions.map((question) => question.order === order
      ? { ...question, [field]: field === 'questionText' ? value : value || null }
      : question),
  }));
  const updateCriterion = (questionOrder: number, criterionOrder: number, field: 'bulletText' | 'domain' | 'sourceWeight', value: string) => edit((current) => ({
    ...current,
    questions: current.questions.map((question) => question.order !== questionOrder ? question : {
      ...question,
      criteria: question.criteria.map((criterion) => criterion.order !== criterionOrder ? criterion : {
        ...criterion,
        [field]: field === 'sourceWeight' ? Number(value) : field === 'bulletText' ? value : value || null,
      }),
    }),
  }));
  const addQuestion = () => edit(addDraftQuestion);
  const removeQuestion = (order: number) => edit((current) => ({
    ...current,
    questions: current.questions.filter((question) => question.order !== order).map((question, index) => ({ ...question, order: index + 1 })),
  }));
  const moveQuestion = (order: number, direction: -1 | 1) => edit((current) => ({ ...current, questions: reordered(current.questions, order, direction) }));
  const addCriterion = (subQuestionId: string) => edit((current) => addDraftCriterion(current, subQuestionId));
  const removeCriterion = (questionOrder: number, criterionOrder: number) => edit((current) => ({
    ...current,
    questions: current.questions.map((question) => question.order !== questionOrder ? question : ({
      ...question,
      criteria: question.criteria.filter((criterion) => criterion.order !== criterionOrder).map((criterion, index) => ({ ...criterion, order: index + 1 })),
    })),
  }));
  const moveCriterion = (questionOrder: number, criterionOrder: number, direction: -1 | 1) => edit((current) => ({
    ...current,
    questions: current.questions.map((question) => question.order !== questionOrder ? question : ({
      ...question,
      criteria: reordered(question.criteria, criterionOrder, direction),
    })),
  }));

  const save = async () => {
    if (isPublished) {
      setNotice({ title: 'Unpublish before editing', message: 'Published content is immutable. Move it to draft, save a new version, then publish that saved version.', tone: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const result = await api.saveStation(draft);
      const saved = { ...draft, expectedVersion: result.version };
      setDraft(saved); setSavedDraft(saved);
      setNotice({ title: 'Draft saved', message: 'A new immutable content version is ready for future attempts.', tone: 'success' });
    } catch (error) {
      const conflict = error instanceof AdminMmiApiError && error.kind === 'version_conflict';
      setNotice({ title: conflict ? 'Version conflict' : 'Draft not saved', message: conflict ? 'This station changed elsewhere. Reload it before saving.' : 'No success was confirmed. Review the station and retry.', tone: 'error' });
    } finally { setSaving(false); setConfirm(null); }
  };
  const setStationStatus = async (next: AdminMmiContentStatus) => {
    if (dirty) {
      setNotice({ title: 'Save changes first', message: 'Status changes apply only to the current saved version. Save or discard edits before publishing, archiving, or restoring.', tone: 'warning' });
      setConfirm(null); return;
    }
    if (!draft.expectedVersion) {
      setNotice({ title: 'Save the draft first', message: 'Publication state is available after the initial immutable version exists.', tone: 'warning' });
      setConfirm(null); return;
    }
    setSaving(true);
    try {
      const result = await api.setStationStatus(draft.stationId, draft.expectedVersion, next);
      const saved = { ...draft, expectedVersion: result.version };
      setDraft(saved); setSavedDraft(saved); setStatus(next);
      setNotice({ title: `Station ${next}`, message: 'This changes only future practice selection; historic attempts keep their snapshot.', tone: 'success' });
    } catch (error) {
      const conflict = error instanceof AdminMmiApiError && error.kind === 'version_conflict';
      setNotice({ title: conflict ? 'Version conflict' : 'Status not changed', message: 'Reload before retrying if another administrator edited this station.', tone: 'error' });
    } finally { setSaving(false); setConfirm(null); }
  };

  if (loading) return <SafeAreaView style={styles.safe}><ActivityIndicator style={{ flex: 1 }} color={colors.teal[400]} /></SafeAreaView>;
  const statusIntent = status === 'published' ? 'draft' : 'published';
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><TouchableOpacity onPress={() => navigateBackOr(router, '/admin/stations')} accessibilityRole="button"><Text style={styles.back}>Back to repository</Text></TouchableOpacity><Text style={styles.headerTitle}>STATION EDITOR</Text><View style={{ width: 148 }} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      {notice ? <InlineNotice {...notice} /> : null}
      {isPublished ? <InlineNotice title="Published stations are locked" message="Unpublish this saved station before changing any content. This protects the immutable version candidates receive." tone="warning" /> : null}
      {confirm ? <ConfirmAction title={confirm === 'save' ? 'Save this draft version?' : `${confirm === 'published' ? 'Publish' : confirm === 'archived' ? 'Archive' : 'Unpublish'} this station?`} message={confirm === 'save' ? 'Saving creates an immutable content version. Historic candidate attempts are unchanged.' : 'This affects availability for future practice only. There is no hard delete because past attempts depend on snapshots.'} confirmLabel={confirm === 'save' ? 'Save draft' : confirm === 'published' ? 'Publish station' : confirm === 'archived' ? 'Archive station' : 'Unpublish station'} destructive={confirm === 'archived'} busy={saving} onConfirm={() => confirm === 'save' ? void save() : void setStationStatus(confirm)} onCancel={() => setConfirm(null)} /> : null}
      <Text style={styles.title}>{stationId ? `Edit ${draft.stationId}` : 'Create station draft'}</Text>
      <Text style={styles.sub}>One 11-minute station: 60 seconds preparation followed by five ordered questions at 120 seconds each. There is no hard delete.</Text>
      <Input label="Stable station ID" value={draft.stationId} editable={canChangeId} onChangeText={(value) => update('stationId', value)} autoCapitalize="none" />
      <Input label="Category" value={draft.category} editable={!isPublished} onChangeText={(value) => update('category', value)} />
      <Input label="Topic" value={draft.topic} editable={!isPublished} onChangeText={(value) => update('topic', value)} />
      <Input label="University tags (comma separated)" value={draft.universityTags.join(', ')} editable={!isPublished} onChangeText={(value) => update('universityTags', value.split(',').map((tag) => tag.trim()).filter(Boolean))} autoCapitalize="none" />
      <Input label="HTTPS image URL (optional)" value={draft.imageUrl ?? ''} editable={!isPublished} onChangeText={(value) => update('imageUrl', value || null)} autoCapitalize="none" />
      <Text style={styles.label}>DIFFICULTY</Text><View style={styles.choices}>{(['foundation', 'intermediate', 'advanced'] as const).map((value) => <TouchableOpacity key={value} disabled={isPublished} onPress={() => update('difficulty', value)} style={[styles.choice, draft.difficulty === value && styles.selected]} accessibilityRole="radio" accessibilityState={{ selected: draft.difficulty === value, disabled: isPublished }}><Text style={styles.choiceText}>{value}</Text></TouchableOpacity>)}</View>
      <Text style={styles.label}>SCENARIO · 60 SECOND PREPARATION</Text><TextInput value={draft.scenarioText} editable={!isPublished} onChangeText={(value) => update('scenarioText', value)} multiline style={styles.longInput} textAlignVertical="top" accessibilityLabel="Scenario" />
      <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Five ordered questions</Text>{draft.questions.length < 5 ? <TouchableOpacity disabled={isPublished} onPress={addQuestion} accessibilityRole="button"><Text style={styles.control}>Add question</Text></TouchableOpacity> : null}</View>
      <Text style={styles.sub}>Every question is fixed at 120 seconds. Criteria are evaluated at equal percentage; source weight is provenance only.</Text>
      {draft.questions.map((question, index) => <View key={question.subQuestionId} style={styles.question}>
        <View style={styles.sectionRow}><Text style={styles.questionTitle}>QUESTION {question.order} · 120 SECONDS</Text><View style={styles.controls}><TouchableOpacity disabled={isPublished || index === 0} onPress={() => moveQuestion(question.order, -1)} accessibilityRole="button"><Text style={styles.control}>Up</Text></TouchableOpacity><TouchableOpacity disabled={isPublished || index === draft.questions.length - 1} onPress={() => moveQuestion(question.order, 1)} accessibilityRole="button"><Text style={styles.control}>Down</Text></TouchableOpacity><TouchableOpacity disabled={isPublished} onPress={() => removeQuestion(question.order)} accessibilityRole="button"><Text style={styles.dangerControl}>Remove</Text></TouchableOpacity></View></View>
        <TextInput value={question.questionText} editable={!isPublished} onChangeText={(value) => updateQuestion(question.order, 'questionText', value)} multiline style={styles.longInput} textAlignVertical="top" accessibilityLabel={`Question ${question.order}`} />
        <Text style={styles.label}>MARKING CRITERIA · EQUAL PERCENTAGE</Text>
        {question.criteria.map((criterion, criterionIndex) => {
          const preview = validation.equalWeightPreview.find((item) => item.subQuestionId === question.subQuestionId)?.criteria.find((item) => item.criterionId === criterion.criterionId)?.weightPct ?? 0;
          return <View key={criterion.criterionId} style={styles.criterion}><View style={styles.sectionRow}><Text style={styles.criterionLabel}>#{criterion.order} · {preview}%</Text><View style={styles.controls}><TouchableOpacity disabled={isPublished || criterionIndex === 0} onPress={() => moveCriterion(question.order, criterion.order, -1)} accessibilityRole="button"><Text style={styles.control}>Up</Text></TouchableOpacity><TouchableOpacity disabled={isPublished || criterionIndex === question.criteria.length - 1} onPress={() => moveCriterion(question.order, criterion.order, 1)} accessibilityRole="button"><Text style={styles.control}>Down</Text></TouchableOpacity><TouchableOpacity disabled={isPublished} onPress={() => removeCriterion(question.order, criterion.order)} accessibilityRole="button"><Text style={styles.dangerControl}>Remove</Text></TouchableOpacity></View></View>
            <TextInput value={criterion.bulletText} editable={!isPublished} onChangeText={(value) => updateCriterion(question.order, criterion.order, 'bulletText', value)} style={styles.criterionInput} accessibilityLabel={`Question ${question.order} criterion ${criterion.order}`} placeholder="Criterion bullet" placeholderTextColor={colors.neutral[500]} />
            <TextInput value={criterion.domain ?? ''} editable={!isPublished} onChangeText={(value) => updateCriterion(question.order, criterion.order, 'domain', value)} style={styles.shortInput} accessibilityLabel={`Question ${question.order} criterion ${criterion.order} domain`} placeholder="Domain" placeholderTextColor={colors.neutral[500]} />
            <TextInput value={String(criterion.sourceWeight)} editable={!isPublished} onChangeText={(value) => updateCriterion(question.order, criterion.order, 'sourceWeight', value)} style={styles.weightInput} keyboardType="decimal-pad" accessibilityLabel={`Question ${question.order} criterion ${criterion.order} source weight`} />
          </View>;
        })}
        <TouchableOpacity disabled={isPublished || question.criteria.length >= 20} onPress={() => addCriterion(question.subQuestionId)} accessibilityRole="button"><Text style={styles.control}>Add criterion</Text></TouchableOpacity>
      </View>)}
      {validation.issues.length ? <InlineNotice title="Draft validation" message={validation.issues.slice(0, 4).map((issue) => issue.message).join(' ')} tone="warning" /> : null}
      <Button label="Save draft version" onPress={() => setConfirm('save')} loading={saving} disabled={saving || isPublished} />
      <View style={styles.actions}><Button label={status === 'published' ? 'Unpublish' : 'Publish'} variant="secondary" onPress={() => setConfirm(statusIntent)} disabled={saving || dirty} style={styles.action} /><Button label={status === 'archived' ? 'Restore draft' : 'Archive'} variant="danger" onPress={() => setConfirm(status === 'archived' ? 'draft' : 'archived')} disabled={saving || dirty} style={styles.action} /></View>
      {dirty ? <Text style={styles.dirty}>Save the current draft before changing its status.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingHorizontal: layout.screenPaddingH, borderBottomWidth: 1, borderBottomColor: colors.primary[800] }, back: { ...text.labelMd, color: colors.primary[800], minWidth: 148 }, headerTitle: { ...text.labelMd, color: colors.primary[800] }, content: { padding: layout.screenPaddingH, paddingBottom: 56, gap: 10 }, title: { ...text.displayLg, color: colors.primary[800] }, sub: { ...text.bodySm, color: colors.neutral[600], lineHeight: 20 }, label: { ...text.labelMd, color: colors.neutral[600], marginTop: 8 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { padding: 9, borderWidth: 1, borderColor: colors.primary[300] }, selected: { borderColor: colors.primary[800], backgroundColor: colors.teal[400] }, choiceText: { ...text.bodySm, color: colors.primary[800], textTransform: 'capitalize' }, longInput: { minHeight: 110, borderWidth: 1, borderColor: colors.primary[300], backgroundColor: colors.bg.white, padding: 10, ...text.bodyMd, color: colors.primary[800] }, sectionTitle: { ...text.headingLg, color: colors.primary[800], marginTop: 10 }, sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, question: { borderWidth: 1, borderColor: colors.primary[300], backgroundColor: colors.bg.white, padding: 14, gap: 8, marginTop: 6 }, questionTitle: { ...text.headingSm, color: colors.primary[800] }, criterion: { borderTopWidth: 1, borderTopColor: colors.bg.tertiary, paddingTop: 8, gap: 6 }, criterionLabel: { ...text.labelMd, color: colors.teal[600] }, criterionInput: { borderWidth: 1, borderColor: colors.primary[300], minHeight: 44, padding: 8, ...text.bodySm, color: colors.primary[800] }, shortInput: { borderWidth: 1, borderColor: colors.primary[300], padding: 8, ...text.bodySm, color: colors.primary[800] }, weightInput: { borderWidth: 1, borderColor: colors.primary[300], padding: 8, ...text.bodySm, color: colors.primary[800], maxWidth: 120 }, actions: { flexDirection: 'row', gap: 10 }, action: { flex: 1 }, controls: { flexDirection: 'row', gap: 10 }, control: { ...text.labelMd, color: colors.teal[600] }, dangerControl: { ...text.labelMd, color: colors.error[600] }, dirty: { ...text.bodySm, color: colors.neutral[600] },
});
