import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { colors, text } from '../../src/theme';

export default function TutorScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.stationPlate}>
        <Text style={styles.stationCode}>CLOSED</Text>
      </View>
      <Text style={styles.eyebrow}>OUTSIDE THE TEST CIRCUIT</Text>
      <Text style={styles.title}>Tutor booking is unavailable</Text>
      <Text style={styles.subtitle}>
        No tutors, bookings, prices, or reviews are offered in this closed preview.
      </Text>

      <Card style={styles.noticeCard}>
        <Text style={styles.noticeLabel}>WHY THIS PAGE EXISTS</Text>
        <Text style={styles.noticeText}>
          Older links may still point here. This holding screen prevents an unfinished marketplace from appearing live.
        </Text>
      </Card>

      <Button label="Back to orient" onPress={() => router.replace('/(tabs)')} variant="secondary" />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  stationPlate: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary[800],
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  stationCode: { ...text.labelMd, color: colors.teal[300] },
  eyebrow: { ...text.labelMd, color: colors.neutral[500], marginBottom: 4 },
  title: { ...text.displayLg, color: colors.primary[800] },
  subtitle: { ...text.bodyMd, color: colors.neutral[500], lineHeight: 23, marginTop: 6, marginBottom: 22 },
  noticeCard: { marginBottom: 18 },
  noticeLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 6 },
  noticeText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 },
});
