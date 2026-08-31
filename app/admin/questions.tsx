import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { ConfirmAction } from '../../src/components/feedback/ConfirmAction';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { pickFile } from '../../src/lib/filePicker';
import {
  createQuestionDraft,
  importQuestionsFromCSV,
} from '../../src/lib/questions';
import { navigateBackOr } from '../../src/lib/navigation';
import { parseQuestionCsv, type ParsedQuestionCsv } from '../../src/features/questions/csv';
import {
  validateQuestionDraft,
  type QuestionDraft,
} from '../../src/features/questions/validation';
import type { QuestionCategory, QuestionDifficulty } from '../../src/types';
import { colors, layout, text } from '../../src/theme';

type DeskMode = 'single' | 'csv';
type Confirmation = 'single' | 'csv' | null;

const CATEGORIES: { value: QuestionCategory; label: string }[] = [
  { value: 'ethics', label: 'Ethics' },
  { value: 'motivation', label: 'Motivation' },
  { value: 'nhs', label: 'NHS' },
  { value: 'teamwork', label: 'Teamwork' },
  { value: 'resilience', label: 'Resilience' },
  { value: 'scenarios', label: 'Scenarios' },
];

const DIFFICULTIES: QuestionDifficulty[] = ['foundation', 'intermediate', 'advanced'];

export default function AdminQuestionsScreen() {
  const [mode, setMode] = useState<DeskMode>('single');
  const [category, setCategory] = useState<QuestionCategory>('ethics');
  const [questionText, setQuestionText] = useState('');
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>('foundation');
  const [subcategory, setSubcategory] = useState('');
  const [tags, setTags] = useState('');
  const [guidanceNotes, setGuidanceNotes] = useState('');
  const [isMmiSuitable, setIsMmiSuitable] = useState(true);
  const [pendingQuestion, setPendingQuestion] = useState<QuestionDraft | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<ParsedQuestionCsv | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    title: string;
    message: string;
    tone: 'info' | 'success' | 'warning' | 'error';
  } | null>(null);

  const resetSingle = () => {
    setQuestionText('');
    setSubcategory('');
    setTags('');
    setGuidanceNotes('');
    setPendingQuestion(null);
  };

  const prepareSingleQuestion = (publishNow: boolean) => {
    const validation = validateQuestionDraft({
      category,
      text: questionText,
      difficulty,
      subcategory,
      university_tags: tags.split(',').map(tag => tag.trim()),
      is_mmi_suitable: isMmiSuitable,
      guidance_notes: guidanceNotes,
      is_active: publishNow,
    });

    if (!validation.success) {
      setNotice({
        title: 'Question needs revision',
        message: validation.issues.join(' '),
        tone: 'error',
      });
      return;
    }

    setNotice(null);
    setPendingQuestion(validation.data);
    setConfirmation('single');
  };

  const handlePickFile = async () => {
    try {
      const picked = await pickFile(['text/csv', 'text/plain', 'application/csv'], 'utf8');
      if (!picked) return;

      const parsed = parseQuestionCsv(picked.content);
      setFileName(picked.name);
      setCsvContent(picked.content);
      setCsvPreview(parsed);
      setConfirmation(null);
      setNotice(parsed.errors.length > 0
        ? {
            title: 'CSV needs revision',
            message: `${parsed.errors.length} issue${parsed.errors.length === 1 ? '' : 's'} must be fixed before import.`,
            tone: 'error',
          }
        : {
            title: 'CSV ready for review',
            message: `${parsed.rows.length} valid source row${parsed.rows.length === 1 ? '' : 's'} form one retry-safe inactive draft batch.`,
            tone: 'info',
          });
    } catch {
      setNotice({ title: 'File not read', message: 'Choose a UTF-8 CSV file of 1 MB or smaller.', tone: 'error' });
    }
  };

  const confirmMutation = async () => {
    setSaving(true);
    try {
      if (confirmation === 'single' && pendingQuestion) {
        await createQuestionDraft(pendingQuestion);
        setNotice({
          title: pendingQuestion.is_active ? 'Question published' : 'Draft saved',
          message: pendingQuestion.is_active
            ? 'The question is now available in its practice station.'
            : 'The question was added as an inactive draft and is not visible to students.',
          tone: 'success',
        });
        resetSingle();
      } else if (confirmation === 'csv' && csvContent) {
        const result = await importQuestionsFromCSV(csvContent);
        setNotice({
          title: result.retried ? 'Draft import already completed' : 'Draft import complete',
          message: result.retried
            ? 'This exact source batch was already committed. Its existing question IDs were returned without creating duplicates.'
            : `${result.inserted} added, ${result.updated} updated, and ${result.unchanged} unchanged source record${result.inserted + result.updated + result.unchanged === 1 ? '' : 's'}. Existing publication state and attempt history were preserved.`,
          tone: 'success',
        });
        setFileName(null);
        setCsvContent(null);
        setCsvPreview(null);
      }
      setConfirmation(null);
    } catch {
      setNotice({
        title: 'Question Desk did not save',
        message: 'No success was confirmed. Check your admin access and connection, then try again.',
        tone: 'error',
      });
      setConfirmation(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigateBackOr(router, '/admin')}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>Back to admin</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QUESTION DESK</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.routeLabel}>COFOUNDER ROUTE / CONTENT</Text>
        <Text style={styles.title}>Add practice questions</Text>
        <Text style={styles.sub}>Create one question in the browser or validate a bounded CSV before anything is written.</Text>

        <View style={styles.modeSwitch}>
          <TouchableOpacity
            onPress={() => setMode('single')}
            style={[styles.modeOption, mode === 'single' && styles.modeOptionActive]}
            accessibilityState={{ selected: mode === 'single' }}
          >
            <Text style={styles.modeCode}>01</Text>
            <Text style={styles.modeLabel}>Add one</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode('csv')}
            style={[styles.modeOption, mode === 'csv' && styles.modeOptionActive]}
            accessibilityState={{ selected: mode === 'csv' }}
          >
            <Text style={styles.modeCode}>02</Text>
            <Text style={styles.modeLabel}>Import CSV</Text>
          </TouchableOpacity>
        </View>

        {notice ? <InlineNotice {...notice} /> : null}

        {confirmation === 'single' && pendingQuestion ? (
          <ConfirmAction
            title={pendingQuestion.is_active ? 'Publish this question now?' : 'Save this inactive draft?'}
            message={pendingQuestion.is_active
              ? 'This inserts one active question and makes it available in Practice immediately.'
              : 'This inserts one inactive question. Students will not see it until it is published.'}
            confirmLabel={pendingQuestion.is_active ? 'Publish question' : 'Save draft'}
            busy={saving}
            onConfirm={confirmMutation}
            onCancel={() => setConfirmation(null)}
          />
        ) : null}

        {confirmation === 'csv' && csvPreview ? (
          <ConfirmAction
            title="Import these drafts?"
            message={`This imports ${csvPreview.rows.length} inactive source draft${csvPreview.rows.length === 1 ? '' : 's'} as one retry-safe batch. A later source batch may update its source-controlled content, but never publish it or reset its attempt history.`}
            confirmLabel="Import drafts"
            busy={saving}
            onConfirm={confirmMutation}
            onCancel={() => setConfirmation(null)}
          />
        ) : null}

        {mode === 'single' ? (
          <View style={styles.sheet}>
            <Text style={styles.sectionTitle}>Candidate prompt</Text>
            <Text style={styles.fieldLabel}>CATEGORY</Text>
            <View style={styles.optionGrid}>
              {CATEGORIES.map(option => (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setCategory(option.value)}
                  style={[styles.option, category === option.value && styles.optionActive]}
                  accessibilityState={{ selected: category === option.value }}
                >
                  <Text style={styles.optionText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>QUESTION TEXT</Text>
            <TextInput
              value={questionText}
              onChangeText={setQuestionText}
              style={[styles.input, styles.questionInput]}
              multiline
              maxLength={2000}
              placeholder="Write the exact prompt shown to the candidate."
              placeholderTextColor={colors.neutral[500]}
              textAlignVertical="top"
            />
            <Text style={styles.counter}>{questionText.length} / 2000</Text>

            <Text style={styles.fieldLabel}>DIFFICULTY</Text>
            <View style={styles.optionGrid}>
              {DIFFICULTIES.map(option => (
                <TouchableOpacity
                  key={option}
                  onPress={() => setDifficulty(option)}
                  style={[styles.option, difficulty === option && styles.optionActive]}
                  accessibilityState={{ selected: difficulty === option }}
                >
                  <Text style={styles.optionText}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>SUBCATEGORY · OPTIONAL</Text>
            <TextInput value={subcategory} onChangeText={setSubcategory} style={styles.input} maxLength={100} />

            <Text style={styles.fieldLabel}>UNIVERSITY TAGS · OPTIONAL, COMMA-SEPARATED</Text>
            <TextInput value={tags} onChangeText={setTags} style={styles.input} autoCapitalize="none" />

            <Text style={styles.fieldLabel}>GUIDANCE NOTES · ADMIN ONLY</Text>
            <TextInput
              value={guidanceNotes}
              onChangeText={setGuidanceNotes}
              style={[styles.input, styles.guidanceInput]}
              multiline
              maxLength={4000}
              textAlignVertical="top"
            />

            <TouchableOpacity
              onPress={() => setIsMmiSuitable(value => !value)}
              style={[styles.checkRow, isMmiSuitable && styles.checkRowActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isMmiSuitable }}
            >
              <Text style={styles.checkMark}>{isMmiSuitable ? 'YES' : 'NO'}</Text>
              <Text style={styles.checkLabel}>Suitable for MMI-style practice</Text>
            </TouchableOpacity>

            <View style={styles.actions}>
              <Button label="Review draft" onPress={() => prepareSingleQuestion(false)} style={styles.action} />
              <Button label="Review & publish" variant="secondary" onPress={() => prepareSingleQuestion(true)} style={styles.action} />
            </View>
          </View>
        ) : (
          <View style={styles.sheet}>
            <Text style={styles.sectionTitle}>Bulk draft import</Text>
            <Text style={styles.helpText}>Required columns: category, text, difficulty, source_namespace, source_id, source_manifest_sha256, source_batch_id</Text>
            <Text style={styles.helpText}>Optional: subcategory, university_tags, is_mmi_suitable, guidance_notes</Text>
            <Text style={styles.helpText}>Maximum: 1 MB and 500 data rows. One file must contain one source batch; newly inserted rows stay inactive, while re-imports never change publication state.</Text>

            <Button
              label={fileName ? 'Choose another CSV' : 'Choose CSV file'}
              onPress={handlePickFile}
              variant="secondary"
              style={styles.fileButton}
            />
            {fileName ? <Text style={styles.fileName}>Selected: {fileName}</Text> : null}

            {csvPreview ? (
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>{csvPreview.rows.length} VALID DRAFTS / {csvPreview.errors.length} ERRORS</Text>
                {csvPreview.rows.slice(0, 3).map(row => (
                  <Text key={row.sourceRow} style={styles.previewLine} numberOfLines={3}>
                    Row {row.sourceRow}: {row.value.category} · {row.value.text}
                  </Text>
                ))}
                {csvPreview.errors.slice(0, 10).map(error => (
                  <Text key={`${error.row}-${error.message}`} style={styles.errorLine}>
                    Row {error.row}: {error.message}
                  </Text>
                ))}
              </View>
            ) : null}

            <Button
              label="Review draft import"
              onPress={() => setConfirmation('csv')}
              disabled={!csvPreview || csvPreview.rows.length === 0 || csvPreview.errors.length > 0}
              style={styles.fileButton}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH, paddingVertical: 12,
    borderBottomWidth: 2, borderBottomColor: colors.primary[800],
  },
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 104, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  headerSpacer: { width: 104 },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', padding: 24, paddingBottom: 56, gap: 16 },
  routeLabel: { ...text.labelMd, color: colors.teal[600] },
  title: { ...text.displayLg, color: colors.primary[900] },
  sub: { ...text.bodyLg, color: colors.neutral[600], maxWidth: 700 },
  modeSwitch: { flexDirection: 'row', gap: 8, marginTop: 6 },
  modeOption: {
    flex: 1, minHeight: 62, borderWidth: 1.5, borderColor: colors.primary[300],
    backgroundColor: colors.bg.white, padding: 12,
  },
  modeOptionActive: { borderColor: colors.primary[900], borderBottomWidth: 8, borderBottomColor: colors.teal[400] },
  modeCode: { ...text.labelMd, color: colors.neutral[600], fontVariant: ['tabular-nums'] },
  modeLabel: { ...text.headingSm, color: colors.primary[900] },
  sheet: { borderWidth: 1, borderColor: colors.primary[300], backgroundColor: colors.bg.white, padding: 22 },
  sectionTitle: { ...text.headingLg, color: colors.primary[900], marginBottom: 8 },
  fieldLabel: { ...text.labelMd, color: colors.neutral[600], marginTop: 18, marginBottom: 8 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1.5, borderColor: colors.primary[300], paddingVertical: 8, paddingHorizontal: 12 },
  optionActive: { borderColor: colors.primary[900], backgroundColor: colors.teal[400] },
  optionText: { ...text.bodySm, color: colors.primary[900], textTransform: 'capitalize' },
  input: {
    borderWidth: 1.5, borderColor: colors.primary[300], backgroundColor: colors.bg.white,
    borderRadius: 2, padding: 12, ...text.bodyMd, color: colors.primary[900],
  },
  questionInput: { minHeight: 130 },
  guidanceInput: { minHeight: 100 },
  counter: { ...text.caption, color: colors.neutral[500], textAlign: 'right', marginTop: 4, fontVariant: ['tabular-nums'] },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.primary[300], padding: 12, marginTop: 18 },
  checkRowActive: { borderColor: colors.primary[900] },
  checkMark: { ...text.labelMd, color: colors.primary[900], backgroundColor: colors.teal[400], padding: 5, minWidth: 42, textAlign: 'center' },
  checkLabel: { ...text.bodyMd, color: colors.primary[900] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  action: { flexGrow: 1, minWidth: 200 },
  helpText: { ...text.bodyMd, color: colors.neutral[700], marginTop: 4 },
  fileButton: { marginTop: 18 },
  fileName: { ...text.bodySm, color: colors.neutral[700] },
  preview: { borderWidth: 1, borderColor: colors.primary[300], padding: 14, marginTop: 14, gap: 7 },
  previewTitle: { ...text.labelMd, color: colors.primary[900], fontVariant: ['tabular-nums'] },
  previewLine: { ...text.bodySm, color: colors.neutral[700] },
  errorLine: { ...text.bodySm, color: colors.error },
});
