import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/authStore';
import { Card } from '../../src/components/ui/Card';
import { navigateBackOr } from '../../src/lib/navigation';
import { colors, text, layout } from '../../src/theme';

export default function AdminDashboard() {
  const profile = useAuthStore(state => state.profile);

  useEffect(() => {
    if (profile && !profile.is_admin) router.replace('/(tabs)');
  }, [profile]);

  if (!profile?.is_admin) return null;

  const AdminCard = ({
    code,
    title,
    description,
    onPress,
  }: {
    code: string;
    title: string;
    description: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
    >
      <Card style={styles.adminCard}>
        <View style={styles.codePlate}>
          <Text style={styles.codeText}>{code}</Text>
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.adminTitle}>{title}</Text>
          <Text style={styles.adminDescription}>{description}</Text>
        </View>
        <Text style={styles.enterLabel}>ENTER</Text>
      </Card>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigateBackOr(router, '/(tabs)')}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>Back to orient</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>CONTROL DESK</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>AUTHORISED PERSONNEL · CLOSED PREVIEW</Text>
        <Text style={styles.title}>Content operations</Text>
        <Text style={styles.subtitle}>
          Prepare practice material and inspect scoring configuration for partner testing.
        </Text>

        <View style={styles.routeRule} />

        <AdminCard
          code="Q01"
          title="Question desk"
          description="Create one question, review it, or import validated CSV drafts."
          onPress={() => router.push('/admin/questions')}
        />

        <AdminCard
          code="C02"
          title="Scoring configuration"
          description="Inspect provider and model settings. Key values remain write-only."
          onPress={() => router.push('/admin/ai-config')}
        />

        <AdminCard
          code="F03"
          title="Feedback desk"
          description="Review partner reports. Author IDs appear only when follow-up is allowed."
          onPress={() => router.push('/admin/feedback')}
        />

        <Card variant="teal" style={styles.noticeCard}>
          <Text style={styles.noticeLabel}>ACCESS NOTICE</Text>
          <Text style={styles.noticeText}>
            This desk is limited to accounts marked as administrators. Role changes remain a controlled Supabase operation.
          </Text>
        </Card>
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
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 112, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  headerSpacer: { width: 112 },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 28, paddingBottom: 48 },
  eyebrow: { ...text.labelMd, color: colors.neutral[500], marginBottom: 5 },
  title: { ...text.displayLg, color: colors.primary[800] },
  subtitle: { ...text.bodyMd, color: colors.neutral[500], lineHeight: 23, marginTop: 5, maxWidth: 620 },
  routeRule: { height: 8, backgroundColor: colors.teal[400], marginVertical: 24 },
  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
    borderColor: colors.primary[800],
  },
  codePlate: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[800],
  },
  codeText: { ...text.headingMd, color: colors.bg.white },
  cardCopy: { flex: 1 },
  adminTitle: { ...text.headingMd, color: colors.primary[800], marginBottom: 2 },
  adminDescription: { ...text.bodySm, color: colors.neutral[500], lineHeight: 19 },
  enterLabel: { ...text.labelMd, color: colors.neutral[500] },
  noticeCard: { marginTop: 12 },
  noticeLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 6 },
  noticeText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 },
});
