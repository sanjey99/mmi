import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { useAuthStore } from '../../src/stores/authStore';
import { TimerRing } from '../../src/components/ui/TimerRing';
import { Button } from '../../src/components/ui/Button';
import { ConfirmAction } from '../../src/components/feedback/ConfirmAction';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { navigateBackOr } from '../../src/lib/navigation';
import { LegacyScoringError } from '../../src/features/practice/scoringApi';
import { ownsCachedPracticeSession } from '../../src/features/practice/restoration';
import { colors, text, layout } from '../../src/theme';

const TIME_LIMIT_SECONDS = 8 * 60;

export default function SessionScreen() {
  const { sessionId, questionId, timed } = useLocalSearchParams<{
    sessionId: string;
    questionId: string;
    timed: string;
  }>();
  const {
    session: cachedSession,
    currentQuestion,
    answerText,
    setAnswerText,
    submitAnswer,
    restoreSession,
    scoring,
  } = usePracticeStore();
  const authenticatedUserId = useAuthStore(state => state.session?.user.id);
  const [submitted, setSubmitted] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [timerNotice, setTimerNotice] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const routeSessionId = typeof sessionId === 'string' ? sessionId : '';
  const routeQuestionId = typeof questionId === 'string' ? questionId : '';
  const isTimed = timed === '1';
  const hasOwnedCachedSession = ownsCachedPracticeSession({
    authenticatedUserId,
    routeSessionId,
    cachedSession,
  });
  const hasOwnedCachedQuestion = hasOwnedCachedSession && currentQuestion?.id === routeQuestionId;

  useEffect(() => {
    if (hasOwnedCachedQuestion) {
      setRestoring(false);
      return;
    }
    if (!routeSessionId || !routeQuestionId) {
      setRestoreError('This station link is incomplete. Return to Practice and open a station again.');
      setRestoring(false);
      return;
    }

    let active = true;
    setRestoring(true);
    setRestoreError(null);
    restoreSession(routeSessionId, routeQuestionId)
      .catch(() => {
        if (active) {
          setRestoreError('This station could not be restored. It may be closed, unavailable, or belong to another account.');
        }
      })
      .finally(() => {
        if (active) setRestoring(false);
      });

    return () => { active = false; };
  }, [hasOwnedCachedQuestion, restoreSession, routeQuestionId, routeSessionId]);

  const handleTextChange = (value: string) => {
    setFormError(null);
    setAnswerText(value);
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => { /* in-memory state settled */ }, 2_000);
  };

  const handleSubmit = async () => {
    setFormError(null);
    if (!answerText.trim()) {
      setFormError('Write your response before submitting.');
      return;
    }
    if (answerText.trim().length < 30) {
      setFormError('Add a more complete response of at least a few sentences before submitting.');
      return;
    }

    setSubmitted(true);
    try {
      await submitAnswer(routeSessionId, routeQuestionId);
      router.replace({ pathname: '/practice/feedback', params: { sessionId: routeSessionId } });
    } catch (error) {
      setSubmitted(false);
      const message = error instanceof LegacyScoringError
        ? error.message
        : 'Your answer could not be scored. It is safe to try again after checking your connection.';
      setFormError(message);
    }
  };

  const handleTimerExpire = () => {
    setTimerNotice('Eight minutes have ended. Your current response is being checked for submission.');
    void handleSubmit();
  };

  if (restoring && !hasOwnedCachedQuestion) {
    return (
      <SafeAreaView style={styles.centeredState}>
        <ActivityIndicator color={colors.primary[800]} size="large" />
        <Text style={styles.stateTitle}>Restoring station</Text>
        <Text style={styles.stateBody}>Checking this session against your account and the active question bank.</Text>
      </SafeAreaView>
    );
  }

  if (!hasOwnedCachedQuestion || !currentQuestion || restoreError) {
    return (
      <SafeAreaView style={styles.centeredState}>
        <InlineNotice
          title="Station unavailable"
          message={restoreError ?? 'This station is no longer available.'}
          tone="error"
        />
        <Button
          label="Return to practice"
          onPress={() => router.replace('/(tabs)/practice')}
          style={styles.stateButton}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setConfirmingLeave(true)} accessibilityRole="button">
          <Text style={styles.backText}>Leave station</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>02 / {currentQuestion.category.toUpperCase()}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {confirmingLeave ? (
            <ConfirmAction
              title="Leave this station?"
              message="The current response is not saved on this device."
              confirmLabel="Leave station"
              destructive
              onConfirm={() => navigateBackOr(router, '/(tabs)/practice')}
              onCancel={() => setConfirmingLeave(false)}
            />
          ) : null}

          {timerNotice ? <InlineNotice title="Time ended" message={timerNotice} tone="warning" /> : null}
          {formError ? <InlineNotice title="Answer not submitted" message={formError} tone="error" /> : null}

          {isTimed ? (
            <View style={styles.timerWrap}>
              <TimerRing
                durationSeconds={TIME_LIMIT_SECONDS}
                onExpire={handleTimerExpire}
                running={!submitted}
                size={100}
              />
            </View>
          ) : null}

          <View style={styles.questionWrap}>
            <Text style={styles.questionLabel}>LAMINATED CANDIDATE BRIEF</Text>
            <Text style={styles.questionText}>{currentQuestion.text}</Text>
          </View>

          <View style={styles.answerSection}>
            <Text style={styles.answerLabel}>YOUR RESPONSE</Text>
            <TextInput
              style={styles.answerInput}
              multiline
              value={answerText}
              onChangeText={handleTextChange}
              placeholder="Structure your response here. Consider the people involved, relevant principles, safe actions, and your reasoning."
              placeholderTextColor={colors.neutral[500]}
              editable={!submitted}
              textAlignVertical="top"
              scrollEnabled={false}
              maxLength={3000}
              accessibilityLabel="Your practice response"
            />
            <Text style={[styles.charCount, answerText.length >= 2800 && styles.charCountWarn]}>
              {answerText.length} / 3000
            </Text>
          </View>

          <Button
            label={scoring ? 'Scoring response' : 'Submit answer'}
            onPress={handleSubmit}
            loading={scoring || submitted}
            disabled={submitted}
            style={styles.submitButton}
          />

          <Text style={styles.savedHint}>Your response is not submitted until you choose Submit answer.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.bg.primary,
    padding: 24,
  },
  stateTitle: { ...text.headingLg, color: colors.primary[900] },
  stateBody: { ...text.bodyMd, color: colors.neutral[600], textAlign: 'center', maxWidth: 520 },
  stateButton: { marginTop: 8, minWidth: 220 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary[800],
  },
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 96, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800], fontVariant: ['tabular-nums'] },
  headerSpacer: { width: 96 },
  content: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    gap: 14,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: 18,
    paddingBottom: 48,
  },
  timerWrap: { alignItems: 'center', marginVertical: 6 },
  questionWrap: {
    borderWidth: 1,
    borderColor: colors.primary[300],
    backgroundColor: colors.bg.white,
    padding: 24,
    marginTop: 2,
  },
  questionLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 12 },
  questionText: { ...text.headingLg, lineHeight: 36, color: colors.primary[900], maxWidth: 720 },
  answerSection: { marginTop: 6 },
  answerLabel: { ...text.labelMd, color: colors.neutral[600], marginBottom: 10 },
  answerInput: {
    backgroundColor: colors.bg.white,
    borderWidth: 1.5,
    borderColor: colors.primary[300],
    borderRadius: 2,
    padding: 18,
    ...text.bodyLg,
    color: colors.primary[800],
    minHeight: 220,
    lineHeight: 28,
  },
  charCount: { ...text.caption, color: colors.neutral[500], textAlign: 'right', marginTop: 6, fontVariant: ['tabular-nums'] },
  charCountWarn: { color: colors.error },
  submitButton: { marginTop: 4 },
  savedHint: { ...text.caption, color: colors.neutral[600], textAlign: 'center' },
});
