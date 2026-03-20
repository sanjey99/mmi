/**
 * Admin — Question Bank Management
 *
 * Allows admins to import questions via CSV file.
 *
 * Expected CSV format (first row = headers):
 *   category,subcategory,text,difficulty,university_tags,is_mmi_suitable,guidance_notes
 *
 * - category: motivation | ethics | nhs | teamwork | resilience | scenarios
 * - difficulty: foundation | intermediate | advanced
 * - university_tags: comma-separated list inside double quotes e.g. "oxford,cambridge,ucl"
 * - is_mmi_suitable: true | false
 * - guidance_notes: optional
 *
 * Example row:
 *   ethics,clinical_scenarios,"A 16-year-old requests...",intermediate,"oxford,cambridge",true,Consider Gillick competence
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { importQuestionsFromCSV } from '../../src/lib/questions';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { colors, text, layout } from '../../src/theme';

type ImportStatus = 'idle' | 'parsing' | 'importing' | 'done' | 'error';

export default function AdminQuestionsScreen() {
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'application/csv'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      setFileName(file.name);
      setStatus('parsing');
      setImportResult(null);
      setErrorMsg(null);

      const content = await FileSystem.readAsStringAsync(file.uri);
      setCsvContent(content);

      // Build a preview (first 3 data rows)
      const lines = content.split('\n').filter(l => l.trim());
      const headerLine = lines[0] ?? '';
      const previewLines = lines.slice(1, 4);
      setPreview([headerLine, ...previewLines]);
      setStatus('idle');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message ?? 'Failed to read file');
    }
  };

  const handleImport = async () => {
    if (!csvContent) return;

    Alert.alert(
      'Import Questions',
      'This will upsert questions into the database. Existing questions with the same text will be updated. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import', onPress: async () => {
            setStatus('importing');
            try {
              const result = await importQuestionsFromCSV(csvContent);
              setImportResult(result);
              setStatus('done');
            } catch (e: any) {
              setStatus('error');
              setErrorMsg(e.message);
            }
          },
        },
      ]
    );
  };

  const handleReset = () => {
    setStatus('idle');
    setFileName(null);
    setPreview([]);
    setCsvContent(null);
    setImportResult(null);
    setErrorMsg(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Admin</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QUESTION BANK</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.title}>Import Questions</Text>
        <Text style={styles.sub}>Upload a CSV file to add or update questions in the database.</Text>

        {/* CSV format guide */}
        <Card variant="teal" style={styles.formatCard}>
          <Text style={styles.formatTitle}>📋 CSV Format</Text>
          <Text style={styles.formatText}>
            First row must be headers. Required columns:{'\n'}
            <Text style={styles.mono}>category, text, difficulty</Text>{'\n\n'}
            Optional columns:{'\n'}
            <Text style={styles.mono}>subcategory, university_tags, is_mmi_suitable, guidance_notes</Text>{'\n\n'}
            Categories: <Text style={styles.mono}>motivation, ethics, nhs, teamwork, resilience, scenarios</Text>{'\n'}
            Difficulty: <Text style={styles.mono}>foundation, intermediate, advanced</Text>
          </Text>
        </Card>

        {/* File picker */}
        {status !== 'importing' && (
          <Button
            label={fileName ? '📄 Change File' : '📂 Select CSV File'}
            onPress={handlePickFile}
            variant="secondary"
            style={{ marginBottom: 16 }}
          />
        )}

        {/* File name */}
        {fileName && (
          <Text style={styles.fileName}>Selected: {fileName}</Text>
        )}

        {/* Preview */}
        {preview.length > 0 && (
          <Card style={styles.previewCard}>
            <Text style={styles.previewTitle}>PREVIEW (first 3 rows)</Text>
            {preview.map((line, i) => (
              <Text key={i} style={[styles.previewLine, i === 0 && styles.previewHeader]} numberOfLines={2}>
                {line}
              </Text>
            ))}
          </Card>
        )}

        {/* Import button */}
        {csvContent && status !== 'importing' && status !== 'done' && (
          <Button label="Import to Database →" onPress={handleImport} style={{ marginTop: 8 }} />
        )}

        {/* Loading */}
        {status === 'importing' && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.teal[400]} />
            <Text style={styles.loadingText}>Importing questions...</Text>
          </View>
        )}

        {/* Success */}
        {status === 'done' && importResult && (
          <Card style={styles.resultCard}>
            <Text style={styles.resultTitle}>✅ Import Complete</Text>
            <Text style={styles.resultText}>{importResult.imported} questions imported successfully.</Text>
            {importResult.errors.length > 0 && (
              <>
                <Text style={styles.resultErrors}>{importResult.errors.length} rows had errors:</Text>
                {importResult.errors.slice(0, 5).map((err, i) => (
                  <Text key={i} style={styles.errorLine}>• {err}</Text>
                ))}
              </>
            )}
            <Button label="Import Another File" onPress={handleReset} variant="secondary" style={{ marginTop: 16 }} />
          </Card>
        )}

        {/* Error */}
        {status === 'error' && errorMsg && (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>❌ Import Failed</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <Button label="Try Again" onPress={handleReset} variant="secondary" style={{ marginTop: 12 }} />
          </Card>
        )}

        {/* Example CSV download hint */}
        <Card style={{ marginTop: 20 }}>
          <Text style={styles.exampleTitle}>Example CSV Row</Text>
          <Text style={styles.exampleCode}>
            {`category,text,difficulty,subcategory,is_mmi_suitable\nethics,"A 16-year-old wants contraception without telling parents. How do you approach this?",intermediate,clinical_scenarios,true`}
          </Text>
        </Card>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.bg.tertiary,
  },
  backText: { ...text.bodyMd, color: colors.teal[400], fontFamily: 'DMSans_500Medium', width: 60 },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 20, paddingBottom: 48 },

  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 24, color: colors.primary[800], marginBottom: 4 },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginBottom: 20 },

  formatCard: { marginBottom: 20 },
  formatTitle: { ...text.headingSm, color: colors.teal[600], marginBottom: 8 },
  formatText: { ...text.bodySm, color: colors.primary[800], lineHeight: 20 },
  mono: { fontFamily: 'DMSans_400Regular', color: colors.teal[600] },

  fileName: { ...text.bodySm, color: colors.neutral[600], marginBottom: 12, fontStyle: 'italic' },

  previewCard: { marginBottom: 16 },
  previewTitle: { ...text.labelMd, color: colors.neutral[500], marginBottom: 8 },
  previewLine: { ...text.caption, color: colors.primary[800], marginBottom: 4, fontFamily: 'DMSans_400Regular' },
  previewHeader: { color: colors.teal[600], fontFamily: 'DMSans_500Medium' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  loadingText: { ...text.bodyMd, color: colors.neutral[600] },

  resultCard: { marginTop: 8 },
  resultTitle: { ...text.headingSm, color: colors.primary[800], marginBottom: 8 },
  resultText: { ...text.bodyMd, color: colors.neutral[700] },
  resultErrors: { ...text.bodySm, color: colors.error, marginTop: 8, marginBottom: 4 },
  errorLine: { ...text.caption, color: colors.error },

  errorCard: { marginTop: 8, borderWidth: 1, borderColor: `${colors.error}30` },
  errorTitle: { ...text.headingSm, color: colors.error, marginBottom: 6 },
  errorText: { ...text.bodyMd, color: colors.neutral[700] },

  exampleTitle: { ...text.labelMd, color: colors.neutral[500], marginBottom: 8 },
  exampleCode: { ...text.caption, color: colors.primary[800], lineHeight: 18, fontFamily: 'DMSans_400Regular' },
});
