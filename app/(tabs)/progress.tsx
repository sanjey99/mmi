import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Card } from '../../src/components/ui/Card';
import { ScoreDimensionBar, SCORE_COLORS } from '../../src/components/ui/ScoreDimensionBar';
import { RadarChart } from '../../src/components/ui/RadarChart';
import { Button } from '../../src/components/ui/Button';
import { colors, text } from '../../src/theme';

const DIMENSIONS: { key: keyof typeof SCORE_COLORS; label: string }[] = [
  { key: 'structure', label: 'Structure' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'communication', label: 'Communication' },
  { key: 'reflection', label: 'Reflection' },
  { key: 'nhs_awareness', label: 'NHS awareness' },
];

export default function ProgressScreen() {
  const profile = useAuthStore(state => state.profile);
  const {
    recentSessions,
    streakData,
    dimensionAverages,
    fetchRecentSessions,
    fetchStreakData,
    fetchDimensionAverages,
  } = usePracticeStore();

  useEffect(() => {
    if (profile) {
      fetchRecentSessions(profile.id);
      fetchStreakData(profile.id);
      fetchDimensionAverages(profile.id);
    }
  }, [profile?.id]);

  const hasDimensionData = DIMENSIONS.every(({ key }) => (
    typeof dimensionAverages[key] === 'number'
  ));
  const scores = dimensionAverages as Record<keyof typeof SCORE_COLORS, number>;
  const focusArea = hasDimensionData
    ? DIMENSIONS.reduce((lowest, candidate) => (
      scores[lowest.key] <= scores[candidate.key] ? lowest : candidate
    ))
    : null;

  return (
    <ScreenWrapper>
      <View style={styles.headingRow}>
        <View style={styles.stationPlate}>
          <Text style={styles.stationNumber}>03</Text>
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>REVIEW ROOM</Text>
          <Text style={styles.title}>Progress record</Text>
          <Text style={styles.subtitle}>Only saved activity from this account appears here.</Text>
        </View>
      </View>

      <View style={styles.streakBoard}>
        <View>
          <Text style={styles.streakLabel}>CURRENT RUN</Text>
          <Text style={styles.streakValue}>{profile?.streak_current ?? 0}</Text>
          <Text style={styles.streakUnit}>consecutive days</Text>
        </View>
        <View style={styles.bestBlock}>
          <Text style={styles.bestLabel}>PERSONAL BEST</Text>
          <Text style={styles.bestValue}>{profile?.streak_longest ?? 0} days</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>LAST 30 DAYS</Text>
      <Card style={styles.calendarCard}>
        <View style={styles.calendarLegend}>
          <Text style={styles.legendText}>FILLED = PRACTISED</Text>
          <Text style={styles.legendText}>OUTLINE = TODAY</Text>
        </View>
        <View style={styles.calendarGrid}>
          {streakData.map(day => {
            const dayNumber = new Date(`${day.date}T00:00:00`).getDate();
            const isToday = day.date === new Date().toISOString().split('T')[0];
            return (
              <View
                key={day.date}
                style={[
                  styles.calendarDay,
                  day.practiced && styles.calendarDayDone,
                  isToday && styles.calendarDayToday,
                ]}
              >
                <Text style={[styles.calendarDayText, day.practiced && styles.calendarDayTextDone]}>
                  {dayNumber}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>

      <Text style={styles.sectionLabel}>ASSESSMENT DIMENSIONS</Text>
      {hasDimensionData ? (
        <>
          <Card style={styles.radarCard}>
            <RadarChart scores={scores} size={210} />
            <Text style={styles.dataNote}>AVERAGE OF YOUR SAVED SCORED RESPONSES</Text>
          </Card>
          <Card style={styles.scoreCard}>
            {DIMENSIONS.map((dimension, index) => (
              <ScoreDimensionBar
                key={dimension.key}
                label={dimension.label}
                score={Math.round(scores[dimension.key])}
                color={SCORE_COLORS[dimension.key]}
                delay={index * 100}
              />
            ))}
          </Card>
        </>
      ) : (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyCode}>NO SCORED RESPONSES</Text>
          <Text style={styles.emptyText}>Complete a practice station to open your dimension record.</Text>
          <Button label="Go to practice" onPress={() => router.push('/(tabs)/practice')} style={styles.emptyAction} />
        </Card>
      )}

      {focusArea ? (
        <Card variant="teal" style={styles.focusCard}>
          <Text style={styles.focusLabel}>NEXT PRACTICE FOCUS</Text>
          <Text style={styles.focusTitle}>{focusArea.label}</Text>
          <Text style={styles.focusText}>
            Current average {scores[focusArea.key].toFixed(1)} of 5. Use this as a prompt for deliberate practice, not a clinical judgement.
          </Text>
        </Card>
      ) : null}

      <Text style={styles.sectionLabel}>RECENT SESSION LOG</Text>
      <View style={styles.sessionTable}>
        {recentSessions.length === 0 ? (
          <Text style={styles.sessionEmpty}>No saved sessions yet.</Text>
        ) : recentSessions.slice(0, 5).map(session => (
          <View key={session.id} style={styles.sessionRow}>
            <Text style={styles.sessionDate}>
              {new Date(session.started_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </Text>
            <Text style={styles.sessionCategory}>{session.category_filter ?? 'Mixed'}</Text>
            <Text style={styles.sessionScore}>
              {session.total_score_pct == null ? 'PENDING' : `${Math.round(session.total_score_pct)}%`}
            </Text>
          </View>
        ))}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 24 },
  stationPlate: {
    width: 62,
    height: 62,
    backgroundColor: colors.primary[800],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationNumber: { ...text.headingLg, color: colors.bg.white },
  headingCopy: { flex: 1 },
  eyebrow: { ...text.labelMd, color: colors.neutral[500] },
  title: { ...text.displayLg, color: colors.primary[800], marginTop: 1 },
  subtitle: { ...text.bodySm, color: colors.neutral[500], marginTop: 3 },
  streakBoard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: colors.primary[800],
    borderLeftWidth: 8,
    borderLeftColor: colors.teal[400],
    padding: 20,
    marginBottom: 28,
  },
  streakLabel: { ...text.labelMd, color: colors.neutral[300] },
  streakValue: { ...text.displayXl, color: colors.bg.white, lineHeight: 68 },
  streakUnit: { ...text.bodySm, color: colors.neutral[300] },
  bestBlock: { alignItems: 'flex-end', paddingBottom: 4 },
  bestLabel: { ...text.labelMd, color: colors.neutral[300] },
  bestValue: { ...text.headingMd, color: colors.teal[300], marginTop: 3 },
  sectionLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 9, marginTop: 2 },
  calendarCard: { marginBottom: 26 },
  calendarLegend: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, gap: 10 },
  legendText: { ...text.labelMd, color: colors.neutral[400] },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  calendarDay: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.white,
  },
  calendarDayDone: { backgroundColor: colors.teal[400], borderColor: colors.primary[800] },
  calendarDayToday: { borderWidth: 3, borderColor: colors.primary[800] },
  calendarDayText: { ...text.labelMd, color: colors.neutral[500] },
  calendarDayTextDone: { color: colors.primary[800] },
  radarCard: { alignItems: 'center', marginBottom: 10 },
  dataNote: { ...text.labelMd, color: colors.neutral[400], marginTop: 4, textAlign: 'center' },
  scoreCard: { marginBottom: 16 },
  emptyCard: { alignItems: 'flex-start', marginBottom: 24 },
  emptyCode: { ...text.labelMd, color: colors.neutral[500], marginBottom: 6 },
  emptyText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 },
  emptyAction: { marginTop: 16, alignSelf: 'stretch' },
  focusCard: { marginBottom: 26 },
  focusLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 5 },
  focusTitle: { ...text.headingLg, color: colors.primary[800] },
  focusText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22, marginTop: 4 },
  sessionTable: { borderTopWidth: 1, borderTopColor: colors.primary[800], marginBottom: 20 },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[800],
  },
  sessionDate: { ...text.labelMd, color: colors.neutral[500], width: 68 },
  sessionCategory: { ...text.bodyMd, color: colors.primary[800], flex: 1, textTransform: 'capitalize' },
  sessionScore: { ...text.labelMd, color: colors.primary[800] },
  sessionEmpty: { ...text.bodyMd, color: colors.neutral[500], paddingVertical: 18 },
});
