import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import type { CofounderFeedbackReview } from '../../src/features/cofounderFeedback/api';
import { getCofounderFeedback } from '../../src/lib/cofounderFeedback';
import { navigateBackOr } from '../../src/lib/navigation';
import { colors, layout, text } from '../../src/theme';

export default function AdminFeedbackScreen() {
  const [items, setItems] = useState<CofounderFeedbackReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setItems(await getCofounderFeedback(100));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigateBackOr(router, '/admin')}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>Back to control desk</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>FEEDBACK DESK</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>COFOUNDER REVIEW · LATEST 100</Text>
        <Text style={styles.title}>Partner field reports</Text>
        <Text style={styles.subtitle}>
          Review what testers saw. Author IDs appear only when the tester allowed follow-up.
        </Text>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.teal[400]} />
            <Text style={styles.loadingText}>Loading reports…</Text>
          </View>
        ) : null}
        {failed ? (
          <InlineNotice
            title="Feedback not available"
            message="The review desk could not load. Check admin access and connection, then try again."
            tone="error"
          />
        ) : null}
        {failed ? <Button label="Try again" onPress={load} variant="secondary" /> : null}
        {!loading && !failed && items.length === 0 ? (
          <InlineNotice
            title="No reports yet"
            message="New partner reports will appear here after the feedback persistence boundary is enabled."
            tone="info"
          />
        ) : null}

        {items.map(item => (
          <Card key={item.id} style={styles.reportCard}>
            <View style={styles.reportHeader}>
              <Text style={styles.reportCode}>{item.severity.toUpperCase()}</Text>
              <Text style={styles.reportMeta}>{item.category.toUpperCase()} · {item.screen.replace('_', ' ').toUpperCase()}</Text>
            </View>
            <Text style={styles.reportMessage}>{item.message}</Text>
            <View style={styles.reportFooter}>
              <Text style={styles.reportDetail}>{new Date(item.createdAt).toLocaleString('en-GB')}</Text>
              <Text style={styles.reportDetail}>BUILD {item.appVersion}</Text>
            </View>
            <Text style={styles.replyDetail}>
              {item.authorId ? `FOLLOW-UP ALLOWED · ${item.authorId}` : 'FOLLOW-UP NOT REQUESTED'}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[800],
  },
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 150, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  headerSpacer: { width: 150 },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 28, paddingBottom: 56 },
  eyebrow: { ...text.labelMd, color: colors.neutral[500], marginBottom: 5 },
  title: { ...text.displayLg, color: colors.primary[800] },
  subtitle: { ...text.bodyMd, color: colors.neutral[500], lineHeight: 23, marginTop: 5, marginBottom: 24 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 24 },
  loadingText: { ...text.bodyMd, color: colors.neutral[500] },
  reportCard: { marginBottom: 12, borderColor: colors.primary[800] },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  reportCode: { ...text.labelMd, color: colors.primary[900], backgroundColor: colors.teal[400], padding: 6 },
  reportMeta: { ...text.labelMd, color: colors.neutral[500], flex: 1, textAlign: 'right' },
  reportMessage: { ...text.bodyMd, color: colors.primary[800], lineHeight: 23 },
  reportFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 16 },
  reportDetail: { ...text.caption, color: colors.neutral[500] },
  replyDetail: { ...text.labelMd, color: colors.neutral[600], marginTop: 10 },
});
