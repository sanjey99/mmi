import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Button } from '../../src/components/ui/Button';
import { colors, text } from '../../src/theme';

export default function PracticeScreen() {
  return (
    <ScreenWrapper>
      <Text style={styles.routeLabel}>02 / PRACTISE</Text>
      <Text style={styles.title}>MMI practice</Text>
      <Text style={styles.sub}>
        Complete one realistic station from the question bank, then receive AI feedback.
      </Text>

      <View style={styles.stationCard}>
        <Text style={styles.stationNumber}>11</Text>
        <View style={styles.stationCopy}>
          <Text style={styles.stationTitle}>11-minute MMI station</Text>
          <Text style={styles.stationDescription}>
            One-minute brief, followed by five two-minute questions.
          </Text>
        </View>
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.detailTitle}>How it works</Text>
        <Text style={styles.detailText}>1. Read the scenario for 60 seconds.</Text>
        <Text style={styles.detailText}>2. Answer five questions in order.</Text>
        <Text style={styles.detailText}>3. Receive AI feedback after the station.</Text>
      </View>

      <Button
        label="Enter station"
        onPress={() => router.push('/practice/mmi-station' as never)}
        style={styles.enterButton}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  routeLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 },
  title: { ...text.displayLg, color: colors.primary[900] },
  sub: {
    ...text.bodyLg,
    color: colors.neutral[600],
    marginTop: 6,
    marginBottom: 24,
    maxWidth: 680,
  },
  stationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: colors.teal[400],
    backgroundColor: colors.teal[100],
  },
  stationNumber: {
    ...text.displayLg,
    color: colors.primary[900],
    fontVariant: ['tabular-nums'],
  },
  stationCopy: { flex: 1 },
  stationTitle: { ...text.headingLg, color: colors.primary[900] },
  stationDescription: { ...text.bodyMd, color: colors.neutral[700], marginTop: 4 },
  detailCard: {
    marginTop: 16,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white,
  },
  detailTitle: { ...text.headingMd, color: colors.primary[900], marginBottom: 2 },
  detailText: { ...text.bodyMd, color: colors.neutral[700] },
  enterButton: { marginTop: 24 },
});
