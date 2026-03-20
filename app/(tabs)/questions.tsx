/**
 * Question Bank — placeholder screen.
 *
 * This screen intentionally shows "Coming Soon" to the student.
 * The full question bank UI (browse, filter, topic drill-down)
 * will be added in Phase 4.
 *
 * The DB table, admin CSV upload, and all infrastructure is already in place.
 * To add the question bank UI, implement this file with:
 *   - Horizontal category filter chips
 *   - University / difficulty dropdowns
 *   - CategoryRow list grouped by category
 *   - Tap → question list → tap question → practice screen
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { router } from 'expo-router';
import { colors, text } from '../../src/theme';

export default function QuestionsScreen() {
  return (
    <ScreenWrapper>
      <Text style={styles.title}>Question Bank</Text>
      <Text style={styles.sub}>Browse and filter all practice questions.</Text>

      <Card variant="teal" style={styles.card}>
        <Text style={styles.cardTitle}>📚 Coming in Phase 4</Text>
        <Text style={styles.cardText}>
          The question bank UI is being built. The database and admin import tools are already live —
          admins can upload questions via CSV right now.
        </Text>
        <Text style={styles.cardText} style={{ marginTop: 8 }}>
          In the meantime, practice using the random question mode which already draws from the question bank.
        </Text>
      </Card>

      <Button
        label="Go to Practice →"
        onPress={() => router.push('/(tabs)/practice')}
        style={{ marginTop: 16 }}
      />

      <View style={styles.comingSoon}>
        <Text style={styles.comingSoonLabel}>PLANNED FEATURES</Text>
        {[
          '📂 Browse by category (Motivation, Ethics, NHS...)',
          '🔍 Search questions by keyword',
          '🎓 Filter by university (Oxford, Imperial...)',
          '⚡ Quick-start a category session',
          '✅ Track which questions you\'ve answered',
        ].map((item, i) => (
          <Text key={i} style={styles.featureItem}>{item}</Text>
        ))}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: colors.primary[800] },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginTop: 4, marginBottom: 24 },
  card: { marginBottom: 8 },
  cardTitle: { ...text.headingSm, color: colors.teal[600], marginBottom: 8 },
  cardText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 22 },
  comingSoon: {
    marginTop: 32, padding: 16,
    backgroundColor: colors.bg.secondary,
    borderRadius: 12,
  },
  comingSoonLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 12 },
  featureItem: { ...text.bodyMd, color: colors.primary[800], marginBottom: 10 },
});
