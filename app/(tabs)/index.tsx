import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { colors, text } from '../../src/theme';

const ROUTE = [
  { station: '01', label: 'Orient', detail: 'You are here' },
  { station: '02', label: 'Practise', detail: 'Choose a live station' },
  { station: '03', label: 'Review', detail: 'Read saved feedback' },
];

export default function HomeScreen() {
  const { profile, refreshProfile } = useAuthStore();
  const { recentSessions, fetchRecentSessions } = usePracticeStore();

  useEffect(() => {
    if (profile) fetchRecentSessions(profile.id);
  }, [profile?.id]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'candidate';
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const todayPractised = recentSessions.filter(session => (
    new Date(session.started_at).toDateString() === new Date().toDateString()
  )).length;
  const initials = profile?.full_name
    ?.split(' ')
    .map(name => name[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() ?? 'IS';

  return (
    <ScreenWrapper onRefresh={refreshProfile} refreshing={false}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>CANDIDATE ORIENTATION · {today.toUpperCase()}</Text>
          <Text style={styles.greeting}>Ready, {firstName}.</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/profile')}
          style={styles.profilePlate}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          <Text style={styles.profileInitials}>{initials}</Text>
          <Text style={styles.profileLabel}>PROFILE</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.threshold}>
        <View style={styles.routeLine} />
        <View style={styles.stationPlate}>
          <Text style={styles.stationKicker}>NEXT STATION</Text>
          <Text style={styles.stationNumber}>02</Text>
        </View>
        <View style={styles.thresholdCopy}>
          <Text style={styles.thresholdTitle}>Choose an interview station</Text>
          <Text style={styles.thresholdText}>
            Read the prompt, prepare your response, then submit when you are ready for feedback.
          </Text>
          <Button label="Enter practice corridor" onPress={() => router.push('/(tabs)/practice')} />
        </View>
      </View>

      <View style={styles.statusRail}>
        <View style={styles.statusCell}>
          <Text style={styles.statusValue}>{todayPractised}</Text>
          <Text style={styles.statusLabel}>TODAY</Text>
        </View>
        <View style={styles.statusCell}>
          <Text style={styles.statusValue}>{profile?.streak_current ?? 0}</Text>
          <Text style={styles.statusLabel}>DAY STREAK</Text>
        </View>
        <View style={styles.statusCell}>
          <Text style={styles.statusValue}>{recentSessions.length}</Text>
          <Text style={styles.statusLabel}>RECENT SESSIONS</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>YOUR ROUTE</Text>
      <View style={styles.routeBoard}>
        {ROUTE.map((stop, index) => (
          <View key={stop.station} style={styles.routeStop}>
            <View style={[styles.routeMarker, index === 0 && styles.routeMarkerCurrent]}>
              <Text style={[styles.routeMarkerText, index === 0 && styles.routeMarkerTextCurrent]}>
                {stop.station}
              </Text>
            </View>
            <View style={styles.routeCopy}>
              <Text style={styles.routeTitle}>{stop.label}</Text>
              <Text style={styles.routeDetail}>{stop.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      {profile?.university_target ? (
        <Card variant="navy" style={styles.targetCard}>
          <Text style={styles.targetLabel}>CANDIDATE BRIEF · TARGET</Text>
          <Text style={styles.targetUniversity}>{profile.university_target.toUpperCase()}</Text>
          <Text style={styles.targetYear}>Medicine · {profile.entry_year ?? 2026} entry</Text>
        </Card>
      ) : null}

      <Card variant="teal" style={styles.previewCard}>
        <Text style={styles.previewTitle}>CLOSED PREVIEW</Text>
        <Text style={styles.previewText}>
          This build is for invited partner testing. Use synthetic answers only and report anything unclear.
        </Text>
      </Card>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 24,
  },
  headerCopy: { flex: 1 },
  eyebrow: { ...text.labelMd, color: colors.neutral[500], marginBottom: 4 },
  greeting: { ...text.displayLg, color: colors.primary[800] },
  profilePlate: {
    minWidth: 64,
    borderWidth: 2,
    borderColor: colors.primary[800],
    backgroundColor: colors.bg.white,
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  profileInitials: { ...text.headingMd, color: colors.primary[800] },
  profileLabel: { ...text.labelMd, color: colors.neutral[500], marginTop: 1 },
  threshold: {
    minHeight: 288,
    borderWidth: 2,
    borderColor: colors.primary[800],
    backgroundColor: colors.bg.white,
    position: 'relative',
    overflow: 'hidden',
    marginBottom: 16,
  },
  routeLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 8,
    backgroundColor: colors.teal[400],
  },
  stationPlate: {
    position: 'absolute',
    left: 24,
    top: 24,
    width: 88,
    backgroundColor: colors.primary[800],
    padding: 12,
  },
  stationKicker: { ...text.labelMd, color: colors.teal[200] },
  stationNumber: { ...text.displayXl, color: colors.bg.white, lineHeight: 66 },
  thresholdCopy: { paddingTop: 132, paddingHorizontal: 24, paddingBottom: 24 },
  thresholdTitle: { ...text.headingLg, color: colors.primary[800], marginBottom: 6 },
  thresholdText: { ...text.bodyMd, color: colors.neutral[600], lineHeight: 23, marginBottom: 18, maxWidth: 620 },
  statusRail: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.primary[800],
    backgroundColor: colors.primary[800],
    gap: 1,
    marginBottom: 28,
  },
  statusCell: { flex: 1, backgroundColor: colors.bg.white, padding: 12 },
  statusValue: { ...text.headingLg, color: colors.primary[800] },
  statusLabel: { ...text.labelMd, color: colors.neutral[500], marginTop: 2 },
  sectionLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 10 },
  routeBoard: { borderTopWidth: 1, borderTopColor: colors.primary[800], marginBottom: 24 },
  routeStop: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[800],
    paddingVertical: 12,
    gap: 14,
  },
  routeMarker: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: colors.primary[800],
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeMarkerCurrent: { backgroundColor: colors.teal[400], borderColor: colors.teal[400] },
  routeMarkerText: { ...text.labelMd, color: colors.primary[800] },
  routeMarkerTextCurrent: { color: colors.primary[800] },
  routeCopy: { flex: 1 },
  routeTitle: { ...text.headingSm, color: colors.primary[800] },
  routeDetail: { ...text.bodySm, color: colors.neutral[500], marginTop: 1 },
  targetCard: { marginBottom: 12 },
  targetLabel: { ...text.labelMd, color: colors.neutral[300], marginBottom: 5 },
  targetUniversity: { ...text.headingLg, color: colors.bg.white },
  targetYear: { ...text.bodySm, color: colors.neutral[300], marginTop: 3 },
  previewCard: { marginBottom: 8 },
  previewTitle: { ...text.labelMd, color: colors.teal[600], marginBottom: 5 },
  previewText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 },
});
