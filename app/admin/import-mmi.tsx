/**
 * Admin — Import MMI Question Bank (med_interview_question_bank.xlsx)
 *
 * Imports three sheets in order:
 *   stations → mmi_stations
 *   sub_questions → mmi_sub_questions
 *   marking_criteria → mmi_marking_criteria
 *
 * panel_questions are handled separately via the CSV import screen.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { pickFile } from '../../src/lib/filePicker';
import { importMMIQuestionBank, previewXlsx } from '../../src/lib/importXlsx';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { colors, text, layout } from '../../src/theme';
import type { XlsxImportResult } from '../../src/types';

type Status = 'idle' | 'parsing' | 'importing' | 'done' | 'error';

export default function ImportMMIScreen() {
  const [status, setStatus]           = useState<Status>('idle');
  const [fileName, setFileName]       = useState<string | null>(null);
  const [base64, setBase64]           = useState<string | null>(null);
  const [preview, setPreview]         = useState<{ sheetName: string; rowCount: number }[]>([]);
  const [result, setResult]           = useState<XlsxImportResult | null>(null);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  const handlePickFile = async () => {
    try {
      const picked = await pickFile(
        [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          '*/*',
        ],
        'base64',
      );
      if (!picked) return;

      setFileName(picked.name);
      setStatus('parsing');
      setResult(null);
      setErrorMsg(null);

      setBase64(picked.content);
      setPreview(previewXlsx(picked.content));
      setStatus('idle');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message ?? 'Failed to read file');
    }
  };

  const handleImport = () => {
    if (!base64) return;
    Alert.alert(
      'Import MMI Question Bank',
      'This will upsert all stations, sub-questions, and marking criteria. Existing rows with matching IDs will be updated. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async () => {
            setStatus('importing');
            try {
              const res = await importMMIQuestionBank(base64);
              setResult(res);
              setStatus('done');
            } catch (e: any) {
              setStatus('error');
              setErrorMsg(e.message);
            }
          },
        },
      ],
    );
  };

  const handleReset = () => {
    setStatus('idle');
    setFileName(null);
    setBase64(null);
    setPreview([]);
    setResult(null);
    setErrorMsg(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Admin</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>MMI QUESTION BANK</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Import MMI Stations</Text>
        <Text style={styles.sub}>
          Upload <Text style={styles.mono}>med_interview_question_bank.xlsx</Text> to import stations, sub-questions, and marking criteria.
        </Text>

        <Card variant="teal" style={styles.infoCard}>
          <Text style={styles.infoTitle}>Expected sheets</Text>
          {[
            ['stations',         'One row per MMI station + scenario text'],
            ['sub_questions',    'Up to 5 Q&A per station'],
            ['marking_criteria', 'Per-criterion bullets with weight + domain'],
          ].map(([name, desc]) => (
            <View key={name} style={styles.sheetRow}>
              <Text style={styles.sheetName}>{name}</Text>
              <Text style={styles.sheetDesc}>{desc}</Text>
            </View>
          ))}
          <Text style={styles.infoNote}>
            panel_questions are imported separately via the CSV upload screen.
          </Text>
        </Card>

        {status !== 'importing' && (
          <Button
            label={fileName ? 'Change File' : 'Select .xlsx File'}
            onPress={handlePickFile}
            variant="secondary"
            style={{ marginBottom: 16 }}
          />
        )}

        {fileName && (
          <Text style={styles.fileName}>Selected: {fileName}</Text>
        )}

        {preview.length > 0 && (
          <Card style={styles.previewCard}>
            <Text style={styles.previewTitle}>FILE PREVIEW</Text>
            {preview.map(({ sheetName, rowCount }) => (
              <View key={sheetName} style={styles.previewRow}>
                <Text style={styles.previewSheet}>{sheetName}</Text>
                <Text style={styles.previewCount}>{rowCount} row{rowCount !== 1 ? 's' : ''}</Text>
              </View>
            ))}
          </Card>
        )}

        {base64 && status !== 'importing' && status !== 'done' && (
          <Button label="Import to Database →" onPress={handleImport} style={{ marginTop: 8 }} />
        )}

        {status === 'importing' && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.teal[400]} />
            <Text style={styles.loadingText}>Importing… this may take a moment.</Text>
          </View>
        )}

        {status === 'done' && result && (
          <Card style={styles.resultCard}>
            <Text style={styles.resultTitle}>Import Complete</Text>
            <Text style={styles.resultTotal}>
              {result.totalInserted} rows upserted across {result.sheets.length} sheets.
            </Text>
            {result.sheets.map(s => (
              <View key={s.name} style={styles.sheetResultRow}>
                <Text style={styles.sheetResultName}>{s.name}</Text>
                <Text style={styles.sheetResultCount}>{s.inserted} rows</Text>
                {s.errors.length > 0 && (
                  <Text style={styles.sheetResultErrors}>{s.errors.length} errors</Text>
                )}
              </View>
            ))}
            {result.totalErrors > 0 && (
              <>
                <Text style={styles.errorHeading}>Row errors:</Text>
                {result.sheets.flatMap(s => s.errors).slice(0, 8).map((e, i) => (
                  <Text key={i} style={styles.errorLine}>Row {e.row}: {e.message}</Text>
                ))}
              </>
            )}
            <Button label="Import Another File" onPress={handleReset} variant="secondary" style={{ marginTop: 16 }} />
          </Card>
        )}

        {status === 'error' && errorMsg && (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>Import Failed</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <Button label="Try Again" onPress={handleReset} variant="secondary" style={{ marginTop: 12 }} />
          </Card>
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
    borderBottomWidth: 1, borderBottomColor: colors.bg.tertiary,
  },
  backText: { ...text.bodyMd, color: colors.teal[400], fontFamily: 'DMSans_500Medium', width: 60 },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 20, paddingBottom: 48 },

  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 24, color: colors.primary[800], marginBottom: 4 },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginBottom: 20 },
  mono: { fontFamily: 'DMSans_400Regular', color: colors.teal[600] },

  infoCard: { marginBottom: 20 },
  infoTitle: { ...text.headingSm, color: colors.teal[600], marginBottom: 10 },
  sheetRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, gap: 8 },
  sheetName: { ...text.bodySm, fontFamily: 'DMSans_500Medium', color: colors.primary[800], width: 130 },
  sheetDesc: { ...text.bodySm, color: colors.neutral[600], flex: 1 },
  infoNote: { ...text.caption, color: colors.neutral[500], marginTop: 8, fontStyle: 'italic' },

  fileName: { ...text.bodySm, color: colors.neutral[600], marginBottom: 12, fontStyle: 'italic' },

  previewCard: { marginBottom: 16 },
  previewTitle: { ...text.labelMd, color: colors.neutral[500], marginBottom: 10 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  previewSheet: { ...text.bodyMd, color: colors.primary[800], fontFamily: 'DMSans_500Medium' },
  previewCount: { ...text.bodySm, color: colors.teal[600], fontFamily: 'DMSans_500Medium' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  loadingText: { ...text.bodyMd, color: colors.neutral[600] },

  resultCard: { marginTop: 8 },
  resultTitle: { ...text.headingSm, color: colors.primary[800], marginBottom: 4 },
  resultTotal: { ...text.bodyMd, color: colors.neutral[600], marginBottom: 12 },
  sheetResultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sheetResultName: { ...text.bodySm, color: colors.primary[800], fontFamily: 'DMSans_500Medium', width: 140 },
  sheetResultCount: { ...text.bodySm, color: colors.teal[600] },
  sheetResultErrors: { ...text.bodySm, color: colors.error },
  errorHeading: { ...text.labelMd, color: colors.error, marginTop: 10, marginBottom: 4 },
  errorLine: { ...text.caption, color: colors.error, marginBottom: 2 },

  errorCard: { marginTop: 8, borderWidth: 1, borderColor: `${colors.error}30` },
  errorTitle: { ...text.headingSm, color: colors.error, marginBottom: 6 },
  errorText: { ...text.bodyMd, color: colors.neutral[700] },
});
