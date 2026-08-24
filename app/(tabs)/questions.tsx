import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { colors, text } from '../../src/theme';

export default function QuestionsScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.stationPlate}>
        <Text style={styles.stationCode}>HOLD</Text>
      </View>
      <Text style={styles.eyebrow}>CLOSED-PREVIEW ROUTE</Text>
      <Text style={styles.title}>Question library is not open</Text>
      <Text style={styles.subtitle}>
        Candidate browsing is outside this preview. Invited administrators can prepare questions from the control desk.
      </Text>

      <Card variant="teal" style={styles.noticeCard}>
        <Text style={styles.noticeLabel}>AVAILABLE PATH</Text>
        <Text style={styles.noticeText}>
          Use Practice to select from active stations. The route shows only categories that currently contain questions.
        </Text>
      </Card>

      <Button label="Open practice" onPress={() => router.replace('/(tabs)/practice')} style={styles.primaryAction} />
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
  noticeLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 6 },
  noticeText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 },
  primaryAction: { marginBottom: 10 },
});
