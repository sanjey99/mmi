import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { useAuthStore } from '../../src/stores/authStore';
import { ownsCachedPracticeSession } from '../../src/features/practice/restoration';
import { RadarChart } from '../../src/components/ui/RadarChart';
import { ScoreDimensionBar, SCORE_COLORS } from '../../src/components/ui/ScoreDimensionBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { colors, text, layout } from '../../src/theme';

const DIMENSIONS: { key: keyof typeof SCORE_COLORS; label: string }[] = [
  { key: 'structure', label: 'Structure' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'communication', label: 'Communication' },
  { key: 'reflection', label: 'Reflection' },
  { key: 'nhs_awareness', label: 'NHS awareness' },
];

function ScoreBadge({ percentage }: { percentage: number }) {
  const color = percentage >= 80
    ? colors.score.ethics
    : percentage >= 60
      ? colors.teal[400]
      : percentage >= 40
        ? colors.score.communication
        : colors.error;
  const label = percentage >= 80
    ? 'STRONG'
    : percentage >= 60
      ? 'GOOD'
      : percentage >= 40
        ? 'DEVELOPING'
        : 'REVIEW';

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgePercentage, { color }]}>{Math.round(percentage)}%</Text>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

export default function FeedbackScreen() {
  const { session: cachedSession, scoreResult, currentQuestion, answerText, clearFeedback } = usePracticeStore();
  const authenticatedUserId = useAuthStore(state => state.session?.user.id);
  const authLoading = useAuthStore(state => state.loading);
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const routeSessionId = typeof sessionId === 'string' ? sessionId : '';
  const hasOwnedCachedSession = ownsCachedPracticeSession({
    authenticatedUserId,
    routeSessionId,
    cachedSession,
  });
  const slideAnimation = useRef(new Animated.Value(24)).current;
  const fadeAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (authLoading || !hasOwnedCachedSession || !scoreResult || !currentQuestion) return;

    Animated.parallel([
      Animated.timing(fadeAnimation, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(slideAnimation, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
    ]).start();

  }, [authLoading, hasOwnedCachedSession, scoreResult, currentQuestion]);

  const handleTryAgain = () => {
    clearFeedback();
    router.replace('/practice');
  };

  const handleNextQuestion = () => {
    clearFeedback();
    router.replace('/practice');
  };

  if (authLoading) return null;
  if (!hasOwnedCachedSession || !scoreResult || !currentQuestion) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.unavailableContent}>
          <Text style={styles.unavailableEyebrow}>REVIEW ROOM · CLOSED PREVIEW</Text>
          <Text style={styles.unavailableTitle}>Feedback unavailable</Text>
          <Text style={styles.unavailableBody}>
            This review cannot be opened from the current account or browser session.
          </Text>
          <Button
            label="Choose a station"
            onPress={() => router.replace('/practice')}
            style={styles.unavailableAction}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleTryAgain} accessibilityRole="button">
          <Text style={styles.backText}>Back to practice</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>REVIEW ROOM</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnimation, transform: [{ translateY: slideAnimation }] }}>
          <View style={styles.resultHeader}>
            <View style={styles.stationPlate}>
              <Text style={styles.stationCode}>03</Text>
              <Text style={styles.stationLabel}>RESULT</Text>
            </View>
            <View style={styles.resultCopy}>
              <Text style={styles.eyebrow}>{currentQuestion.category.toUpperCase()} · SAVED RESPONSE</Text>
              <Text style={styles.title}>Station feedback</Text>
            </View>
          </View>

          <View style={styles.scorePanel}>
            <ScoreBadge percentage={scoreResult.overall_pct} />
            <View style={styles.scoreExplanation}>
              <Text style={styles.scoreLabel}>OVERALL SCORE</Text>
              <Text style={styles.scoreText}>Use this as practice guidance, not as a clinical or admissions judgement.</Text>
            </View>
          </View>

          <Card style={styles.radarCard}>
            <Text style={styles.sectionLabel}>DIMENSION MAP</Text>
            <View style={styles.radarWrap}>
              <RadarChart scores={scoreResult} size={220} />
            </View>
          </Card>

          <Card style={styles.barsCard}>
            <Text style={styles.sectionLabel}>ASSESSOR BREAKDOWN</Text>
            {DIMENSIONS.map((dimension, index) => (
              <ScoreDimensionBar
                key={dimension.key}
                label={dimension.label}
                score={scoreResult[dimension.key]}
                color={SCORE_COLORS[dimension.key]}
                delay={index * 100}
              />
            ))}
          </Card>

          <Card style={styles.feedbackCard}>
            <Text style={styles.sectionLabel}>FEEDBACK</Text>
            <Text style={styles.readingText}>{scoreResult.ai_feedback}</Text>
          </Card>

          <Card variant="teal" style={styles.tipCard}>
            <Text style={styles.tipLabel}>NEXT IMPROVEMENT</Text>
            <Text style={styles.readingText}>{scoreResult.improvement_tip}</Text>
          </Card>

          <Card style={styles.answerCard}>
            <Text style={styles.sectionLabel}>YOUR ANSWER</Text>
            <Text style={styles.answerText}>{answerText}</Text>
          </Card>

          <Card style={styles.questionCard}>
            <Text style={styles.sectionLabel}>STATION PROMPT</Text>
            <Text style={styles.questionText}>{currentQuestion.text}</Text>
          </Card>

          <View style={styles.actions}>
            <Button label="Another station" onPress={handleNextQuestion} style={styles.actionButton} />
            <Button
              label="Open progress"
              onPress={() => router.replace('/(tabs)/progress')}
              variant="secondary"
              style={styles.actionButton}
            />
          </View>

          <Text style={styles.persistenceNote}>SCORE SAVED TO YOUR CLOSED-PREVIEW ACCOUNT</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  unavailableContent: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: 40,
  },
  unavailableEyebrow: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 },
  unavailableTitle: { ...text.displayLg, color: colors.primary[900] },
  unavailableBody: { ...text.bodyLg, color: colors.neutral[600], lineHeight: 26, marginTop: 10 },
  unavailableAction: { alignSelf: 'flex-start', minWidth: 210, marginTop: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[800],
  },
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 116, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  headerSpacer: { width: 116 },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 24, paddingBottom: 48 },
  resultHeader: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 20 },
  stationPlate: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[800],
  },
  stationCode: { ...text.headingLg, color: colors.bg.white, lineHeight: 27 },
  stationLabel: { ...text.labelMd, color: colors.teal[300] },
  resultCopy: { flex: 1 },
  eyebrow: { ...text.labelMd, color: colors.neutral[500] },
  title: { ...text.displayLg, color: colors.primary[800], marginTop: 1 },
  scorePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    borderTopWidth: 8,
    borderTopColor: colors.teal[400],
    backgroundColor: colors.primary[800],
    padding: 18,
    marginBottom: 12,
  },
  badge: {
    width: 118,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    backgroundColor: colors.bg.white,
  },
  badgePercentage: { ...text.displayLg, lineHeight: 42 },
  badgeLabel: { ...text.labelMd, marginTop: 2 },
  scoreExplanation: { flex: 1 },
  scoreLabel: { ...text.labelMd, color: colors.teal[300], marginBottom: 5 },
  scoreText: { ...text.bodySm, color: colors.neutral[300], lineHeight: 20 },
  sectionLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 12 },
  radarCard: { marginBottom: 12 },
  radarWrap: { alignItems: 'center', marginVertical: 4 },
  barsCard: { marginBottom: 12 },
  feedbackCard: { marginBottom: 12 },
  tipCard: { marginBottom: 12 },
  answerCard: { marginBottom: 12 },
  questionCard: { marginBottom: 20 },
  tipLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 },
  readingText: { ...text.bodyMd, color: colors.primary[800], lineHeight: 24 },
  answerText: { ...text.bodyMd, color: colors.neutral[600], lineHeight: 23 },
  questionText: { ...text.headingSm, color: colors.primary[800], lineHeight: 25 },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  actionButton: { flex: 1 },
  persistenceNote: { ...text.labelMd, color: colors.neutral[400], textAlign: 'center' },
});
