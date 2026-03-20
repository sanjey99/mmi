/**
 * Admin Dashboard
 *
 * Accessible only to users with `is_admin = true` in their profile.
 * Guard is applied in this file — non-admins are redirected to tabs.
 *
 * From here, admins can:
 *  - Configure the AI provider (api key, model, base_url)
 *  - Upload questions via CSV
 *  - View basic usage stats (future)
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/authStore';
import { Card } from '../../src/components/ui/Card';
import { colors, text, layout } from '../../src/theme';

export default function AdminDashboard() {
  const profile = useAuthStore(s => s.profile);

  // Redirect non-admins back
  useEffect(() => {
    if (profile && !profile.is_admin) {
      router.replace('/(tabs)');
    }
  }, [profile]);

  if (!profile?.is_admin) return null;

  const AdminCard = ({
    icon, title, description, onPress,
  }: { icon: string; title: string; description: string; onPress: () => void }) => (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <Card style={styles.adminCard} elevated>
        <Text style={styles.adminIcon}>{icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.adminTitle}>{title}</Text>
          <Text style={styles.adminDesc}>{description}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Card>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ADMIN</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Admin Panel</Text>
        <Text style={styles.sub}>Manage AI configuration and question bank.</Text>

        <AdminCard
          icon="🤖"
          title="AI Configuration"
          description="Set AI provider, API key, model, and base URL"
          onPress={() => router.push('/admin/ai-config')}
        />

        <AdminCard
          icon="📚"
          title="Question Bank"
          description="Import questions via CSV upload"
          onPress={() => router.push('/admin/questions')}
        />

        <Card variant="teal" style={styles.infoCard}>
          <Text style={styles.infoTitle}>🔒 Admin Only</Text>
          <Text style={styles.infoText}>
            This panel is only visible to accounts with admin access.
            Contact your system administrator to grant or revoke admin privileges via Supabase.
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
  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: colors.primary[800], marginBottom: 6 },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginBottom: 24 },
  adminCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12,
  },
  adminIcon: { fontSize: 28 },
  adminTitle: { ...text.headingSm, color: colors.primary[800], marginBottom: 2 },
  adminDesc: { ...text.bodySm, color: colors.neutral[500] },
  chevron: { ...text.headingMd, color: colors.neutral[300], fontSize: 24 },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 20, paddingBottom: 48 },
  infoCard: { marginTop: 8 },
  infoTitle: { ...text.headingSm, color: colors.teal[600], marginBottom: 6 },
  infoText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 },
});
