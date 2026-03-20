import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuthStore } from '../../src/stores/authStore';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Card } from '../../src/components/ui/Card';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { ScoreDimensionBar, SCORE_COLORS } from '../../src/components/ui/ScoreDimensionBar';
import { RadarChart } from '../../src/components/ui/RadarChart';
import { Button } from '../../src/components/ui/Button';
import { router } from 'expo-router';
import { colors, text } from '../../src/theme';

export default function ProgressScreen() {
  const profile = useAuthStore(s => s.profile);
  const { recentSessions, streakData, dimensionAverages, fetchRecentSessions, fetchStreakData, fetchDimensionAverages } = usePracticeStore();

  useEffect(() => {
    if (profile) {
      fetchRecentSessions(profile.id);
      fetchStreakData(profile.id);
      fetchDimensionAverages(profile.id);
    }
  }, [profile?.id]);

  const hasDimData = Object.keys(dimensionAverages).length > 0;
  const dummyScores = { structure: 3, ethics: 3, communication: 3, reflection: 3, nhs_awareness: 3 };
  const scores = hasDimData ? (dimensionAverages as any) : dummyScores;

  const DIMENSIONS: { key: keyof typeof SCORE_COLORS; label: string }[] = [
    { key: 'structure', label: 'Structure' },
    { key: 'ethics', label: 'Ethics' },
    { key: 'communication', label: 'Communication' },
    { key: 'reflection', label: 'Reflection' },
    { key: 'nhs_awareness', label: 'NHS Awareness' },
  ];

  const weakArea = hasDimData
    ? DIMENSIONS.reduce((a, b) => (scores[a.key] < scores[b.key] ? a : b))
    : null;

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Progress</Text>

      {/* Streak */}
      <Card style={styles.streakCard}>
        <View style={styles.streakRow}>
          <Text style={styles.streakEmoji}>🔥</Text>
          <View>
            <Text style={styles.streakVal}>{profile?.streak_current ?? 0} day streak</Text>
            <Text style={styles.streakSub}>Longest: {profile?.streak_longest ?? 0} days</Text>
          </View>
        </View>
      </Card>

      {/* Streak calendar */}
      <SectionHeader title="March Calendar" />
      <Card>
        <View style={styles.calGrid}>
          {streakData.map((d, i) => {
            const dayNum = new Date(d.date).getDate();
            const isToday = d.date === new Date().toISOString().split('T')[0];
            return (
              <View key={i} style={[
                styles.calDot,
                d.practiced && styles.calDotDone,
                isToday && styles.calDotToday,
              ]}>
                <Text style={[styles.calDayNum, (d.practiced || isToday) && styles.calDayNumLight]}>{dayNum}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      {/* Radar chart */}
      <SectionHeader title="Dimension Averages" />
      <Card style={{ alignItems: 'center' }}>
        {hasDimData ? (
          <>
            <RadarChart scores={scores} size={200} />
            <Text style={styles.radarHint}>Based on your last sessions</Text>
          </>
        ) : (
          <Text style={styles.emptyText}>Complete practice sessions to see your dimension averages here.</Text>
        )}
      </Card>

      {/* Dimension bars */}
      {hasDimData && (
        <>
          <SectionHeader title="Score Breakdown" />
          <Card>
            {DIMENSIONS.map((d, i) => (
              <ScoreDimensionBar
                key={d.key}
                label={d.label}
                score={Math.round(scores[d.key] ?? 3)}
                color={SCORE_COLORS[d.key]}
                delay={i * 100}
              />
            ))}
          </Card>
        </>
      )}

      {/* Weak area */}
      {weakArea && (
        <>
          <SectionHeader title="Suggested Focus" />
          <Card variant="teal" style={{ marginBottom: 8 }}>
            <Text style={styles.weakTitle}>⚠️ {weakArea.label} — avg {scores[weakArea.key]?.toFixed(1)}/5</Text>
            <Text style={styles.weakText}>This is your lowest scoring dimension. Practise more questions in this area.</Text>
            <Button label="Practice Now" onPress={() => router.push('/(tabs)/practice')} style={{ height: 40, marginTop: 12 }} />
          </Card>
        </>
      )}

      {/* Recent sessions */}
      <SectionHeader title="Recent Sessions" />
      {recentSessions.length === 0 ? (
        <Text style={styles.emptyText}>No sessions yet. Start your first practice above.</Text>
      ) : (
        recentSessions.slice(0, 5).map(s => (
          <View key={s.id} style={styles.sessionRow}>
            <Text style={styles.sessionDate}>
              {new Date(s.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </Text>
            <Text style={styles.sessionCat}>{s.category_filter ?? 'Mixed'}</Text>
            {s.total_score_pct != null && (
              <Text style={styles.sessionScore}>{Math.round(s.total_score_pct)}%</Text>
            )}
          </View>
        ))
      )}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: colors.primary[800], marginBottom: 16 },
  streakCard: { flexDirection: 'row' },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  streakEmoji: { fontSize: 32 },
  streakVal: { ...text.headingMd, color: colors.primary[800] },
  streakSub: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  calDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.neutral[100], alignItems: 'center', justifyContent: 'center' },
  calDotDone: { backgroundColor: colors.teal[400] },
  calDotToday: { backgroundColor: colors.primary[800] },
  calDayNum: { fontSize: 11, color: colors.neutral[500], fontFamily: 'DMSans_500Medium' },
  calDayNumLight: { color: '#fff' },
  radarHint: { ...text.caption, color: colors.neutral[500], marginTop: 8 },
  emptyText: { ...text.bodyMd, color: colors.neutral[500], textAlign: 'center', paddingVertical: 20 },
  weakTitle: { ...text.headingSm, color: colors.teal[600], marginBottom: 6 },
  weakText: { ...text.bodyMd, color: colors.primary[800] },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.bg.tertiary, gap: 12,
  },
  sessionDate: { ...text.bodyMd, color: colors.neutral[500], width: 60 },
  sessionCat: { ...text.bodyMd, color: colors.primary[800], flex: 1, textTransform: 'capitalize' },
  sessionScore: { ...text.headingSm, color: colors.teal[500] },
});
