import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { StatCard } from '../../src/components/ui/StatCard';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { colors, text } from '../../src/theme';

const CATEGORIES = [
  { key: 'motivation', icon: '💡', name: 'Motivation', sub: 'Why Medicine, work experience', pct: 60 },
  { key: 'ethics', icon: '⚖️', name: 'Ethics', sub: 'Four pillars, clinical scenarios', pct: 10 },
  { key: 'nhs', icon: '🏥', name: 'NHS & Healthcare', sub: 'Current issues, structure', pct: 0 },
  { key: 'teamwork', icon: '🤝', name: 'Teamwork', sub: 'Collaboration, leadership', pct: 30 },
  { key: 'resilience', icon: '💪', name: 'Resilience', sub: 'Handling failure, pressure', pct: 0 },
  { key: 'scenarios', icon: '🎭', name: 'Scenarios', sub: 'MMI-style role-play', pct: 0 },
];

export default function HomeScreen() {
  const { profile, refreshProfile } = useAuthStore();
  const { recentSessions, fetchRecentSessions } = usePracticeStore();

  useEffect(() => {
    if (profile) fetchRecentSessions(profile.id);
  }, [profile?.id]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const todayPracticed = recentSessions.filter(s => {
    const d = new Date(s.started_at);
    return d.toDateString() === new Date().toDateString();
  }).length;

  return (
    <ScreenWrapper onRefresh={refreshProfile} refreshing={false}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning, {firstName}</Text>
          <Text style={styles.date}>{today}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/profile')} style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <SectionHeader title="Today's Stats" style={{ marginTop: 8 }} />
      <View style={styles.statGrid}>
        <StatCard icon="📅" label="Today" value={`${todayPracticed}/${profile?.daily_goal ?? 5}`} active={todayPracticed > 0} />
        <StatCard icon="🔥" label="Streak" value={`${profile?.streak_current ?? 0}`} sub="days" />
        <StatCard icon="🚀" label="Sessions" value={`${recentSessions.length}`} sub="total" />
        <StatCard icon="📊" label="Best Streak" value={`${profile?.streak_longest ?? 0}`} sub="days" />
      </View>

      {/* Target university card */}
      {profile?.university_target && (
        <>
          <SectionHeader title="Your Target" />
          <Card variant="navy" style={styles.targetCard}>
            <Text style={styles.targetLabel}>🎓 Target University</Text>
            <Text style={styles.targetUni}>{profile.university_target.toUpperCase()}</Text>
            <Text style={styles.targetYear}>Medicine A100 · {profile.entry_year ?? 2026} entry</Text>
            <Button
              label="Quick Practice →"
              onPress={() => router.push('/(tabs)/practice')}
              style={styles.targetBtn}
            />
          </Card>
        </>
      )}

      {/* Categories */}
      <SectionHeader title="Categories" />
      {CATEGORIES.map(cat => (
        <TouchableOpacity
          key={cat.key}
          style={styles.catRow}
          onPress={() => router.push('/(tabs)/practice')}
          activeOpacity={0.7}
        >
          <Text style={styles.catIcon}>{cat.icon}</Text>
          <View style={styles.catInfo}>
            <Text style={styles.catName}>{cat.name}</Text>
            <Text style={styles.catSub}>{cat.sub}</Text>
            <View style={styles.catBar}>
              <View style={[styles.catFill, { width: `${cat.pct}%` }]} />
            </View>
          </View>
          <View style={styles.catRight}>
            <Text style={styles.catPct}>{cat.pct}%</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </TouchableOpacity>
      ))}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  greeting: { fontFamily: 'DMSans_700Bold', fontSize: 20, color: colors.primary[800] },
  date: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.teal[400],
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  targetCard: { marginBottom: 4 },
  targetLabel: { ...text.labelMd, color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
  targetUni: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 22, color: '#fff', marginBottom: 2 },
  targetYear: { ...text.bodySm, color: 'rgba(255,255,255,0.65)', marginBottom: 16 },
  targetBtn: { backgroundColor: '#fff', height: 44 },
  catRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.bg.tertiary,
  },
  catIcon: { fontSize: 22, width: 36 },
  catInfo: { flex: 1 },
  catName: { ...text.bodyMd, color: colors.primary[800], fontFamily: 'DMSans_500Medium' },
  catSub: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
  catBar: { height: 3, backgroundColor: colors.bg.tertiary, borderRadius: 99, marginTop: 6, overflow: 'hidden' },
  catFill: { height: '100%', backgroundColor: colors.teal[400], borderRadius: 99 },
  catRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 12 },
  catPct: { ...text.caption, color: colors.teal[400], fontFamily: 'DMSans_500Medium' },
  chevron: { color: colors.neutral[300], fontSize: 18 },
});
