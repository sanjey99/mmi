import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { useAuthStore } from '../../src/stores/authStore';
import { RadarChart } from '../../src/components/ui/RadarChart';
import { ScoreDimensionBar, SCORE_COLORS } from '../../src/components/ui/ScoreDimensionBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { colors, text, layout, shadows } from '../../src/theme';

const DIMENSIONS: { key: keyof typeof SCORE_COLORS; label: string }[] = [
  { key: 'structure', label: 'Structure' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'communication', label: 'Communication' },
  { key: 'reflection', label: 'Reflection' },
  { key: 'nhs_awareness', label: 'NHS Awareness' },
];

function ScoreBadge({ pct }: { pct: number }) {
  const color = pct >= 80 ? colors.score.ethics : pct >= 60 ? colors.teal[400] : pct >= 40 ? colors.score.communication : colors.error;
  const label = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Good' : pct >= 40 ? 'Developing' : 'Needs Work';
  return (
    <View style={[styles.badge, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
      <Text style={[styles.badgePct, { color }]}>{Math.round(pct)}%</Text>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

export default function FeedbackScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { scoreResult, currentQuestion, answerText, clearFeedback, endSession } = usePracticeStore();
  const profile = useAuthStore(s => s.profile);

  // Slide-up animation for content sections
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
    ]).start();

    // End session in background
    if (sessionId) endSession(sessionId).catch(() => {});
  }, []);

  const handleTryAgain = () => {
    clearFeedback();
    router.replace('/(tabs)/practice');
  };

  const handleNextQuestion = () => {
    clearFeedback();
    router.replace('/(tabs)/practice');
  };

  // Guard: if no score yet (e.g. navigated here directly), go back
  if (!scoreResult || !currentQuestion) {
    router.replace('/(tabs)/practice');
    return null;
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleTryAgain}>
          <Text style={styles.backText}>‹ Practice</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI FEEDBACK</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* Overall score hero */}
          <View style={styles.scoreHero}>
            <ScoreBadge pct={scoreResult.overall_pct} />
            <Text style={styles.categoryLabel}>{currentQuestion.category.toUpperCase()}</Text>
          </View>

          {/* Radar chart */}
          <Card style={styles.radarCard}>
            <Text style={styles.sectionLabel}>DIMENSION BREAKDOWN</Text>
            <View style={{ alignItems: 'center', marginVertical: 8 }}>
              <RadarChart scores={scoreResult} size={220} />
            </View>
          </Card>

          {/* Score bars */}
          <Card style={styles.barsCard}>
            {DIMENSIONS.map((d, i) => (
              <ScoreDimensionBar
                key={d.key}
                label={d.label}
                score={scoreResult[d.key]}
                color={SCORE_COLORS[d.key]}
                delay={i * 100}
              />
            ))}
          </Card>

          {/* AI Feedback */}
          <Card style={styles.feedbackCard}>
            <Text style={styles.sectionLabel}>FEEDBACK</Text>
            <Text style={styles.feedbackText}>{scoreResult.ai_feedback}</Text>
          </Card>

          {/* Improvement tip */}
          <Card variant="teal" style={styles.tipCard}>
            <Text style={styles.tipLabel}>💡 IMPROVEMENT TIP</Text>
            <Text style={styles.tipText}>{scoreResult.improvement_tip}</Text>
          </Card>

          {/* Your answer (collapsible preview) */}
          <Card style={styles.answerCard}>
            <Text style={styles.sectionLabel}>YOUR ANSWER</Text>
            <Text style={styles.answerPreview} numberOfLines={4}>{answerText}</Text>
          </Card>

          {/* Question recap */}
          <Card style={styles.questionCard}>
            <Text style={styles.sectionLabel}>QUESTION</Text>
            <Text style={styles.questionText}>{currentQuestion.text}</Text>
          </Card>

          {/* Action buttons */}
          <View style={styles.actions}>
            <Button
              label="Practice Again →"
              onPress={handleNextQuestion}
              style={{ flex: 1 }}
            />
            <Button
              label="Progress"
              onPress={() => router.replace('/(tabs)/progress')}
              variant="secondary"
              style={{ flex: 1 }}
            />
          </View>

          <Text style={styles.hint}>Results are not stored on this device</Text>
        </Animated.View>
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

  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 20, paddingBottom: 48 },

  scoreHero: {
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  badge: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    gap: 2,
  },
  badgePct: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 48,
    lineHeight: 52,
  },
  badgeLabel: {
    ...text.labelMd,
    letterSpacing: 1.5,
  },
  categoryLabel: { ...text.caption, color: colors.neutral[400], letterSpacing: 1.5 },

  sectionLabel: { ...text.labelMd, color: colors.neutral[400], marginBottom: 12 },

  radarCard: { marginBottom: 12 },
  barsCard: { marginBottom: 12 },
  feedbackCard: { marginBottom: 12 },
  tipCard: { marginBottom: 12 },
  answerCard: { marginBottom: 12 },
  questionCard: { marginBottom: 20 },

  feedbackText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 24 },

  tipLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 },
  tipText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 24 },

  answerPreview: { ...text.bodyMd, color: colors.neutral[600], lineHeight: 22, fontStyle: 'italic' },

  questionText: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 18, lineHeight: 26,
    color: colors.primary[800],
  },

  actions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  hint: { ...text.caption, color: colors.neutral[300], textAlign: 'center' },
});
