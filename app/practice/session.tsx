import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { TimerRing } from '../../src/components/ui/TimerRing';
import { Button } from '../../src/components/ui/Button';
import { colors, text, layout } from '../../src/theme';

export default function SessionScreen() {
  const { sessionId, questionId, timed } = useLocalSearchParams<{ sessionId: string; questionId: string; timed: string }>();
  const { currentQuestion, answerText, setAnswerText, submitAnswer, scoring, scoringError } = usePracticeStore();
  const [submitted, setSubmitted] = useState(false);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTimed = timed === '1';
  const TIME_LIMIT = 8 * 60; // 8 minutes

  const handleTextChange = (t: string) => {
    setAnswerText(t);
    // Debounced autosave indicator
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => { /* saved locally */ }, 2000);
  };

  const handleSubmit = async () => {
    if (!answerText.trim()) {
      Alert.alert('Answer required', 'Please write your answer before submitting.');
      return;
    }
    if (answerText.trim().length < 30) {
      Alert.alert('Answer too short', 'Please write a more complete answer (at least a few sentences).');
      return;
    }

    setSubmitted(true);
    try {
      await submitAnswer(sessionId, questionId);
      router.replace({ pathname: '/practice/feedback', params: { sessionId } });
    } catch (e: any) {
      setSubmitted(false);
      Alert.alert(
        'Could not score answer',
        e.message.includes('API key not configured')
          ? 'The AI is not configured yet. Ask an admin to set up the AI provider in Settings.'
          : e.message,
      );
    }
  };

  const handleTimerExpire = useCallback(() => {
    Alert.alert('Time\'s up!', 'Your time has expired. Submitting your answer now.', [
      { text: 'OK', onPress: handleSubmit },
    ]);
  }, [answerText]);

  if (!currentQuestion) {
    router.back();
    return null;
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          Alert.alert('Leave session?', 'Your answer will not be saved.', [
            { text: 'Stay', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: () => router.back() },
          ]);
        }}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{currentQuestion.category.toUpperCase()}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Timer (timed mode only) */}
          {isTimed && (
            <View style={styles.timerWrap}>
              <TimerRing durationSeconds={TIME_LIMIT} onExpire={handleTimerExpire} running={!submitted} size={100} />
            </View>
          )}

          {/* Question */}
          <View style={styles.questionWrap}>
            <Text style={styles.questionLabel}>QUESTION</Text>
            <Text style={styles.questionText}>{currentQuestion.text}</Text>
          </View>

          {/* Answer area */}
          <View style={styles.answerSection}>
            <Text style={styles.answerLabel}>YOUR ANSWER</Text>
            <TextInput
              style={styles.answerInput}
              multiline
              value={answerText}
              onChangeText={handleTextChange}
              placeholder="Begin your response here. Structure your answer clearly — consider the ethical principles involved, stakeholder perspectives, and your own reflection..."
              placeholderTextColor={colors.neutral[300]}
              editable={!submitted}
              textAlignVertical="top"
              scrollEnabled={false}
            />
            <Text style={styles.charCount}>{answerText.length} characters</Text>
          </View>

          <Button
            label={scoring ? 'Analysing...' : 'Submit Answer →'}
            onPress={handleSubmit}
            loading={scoring || submitted}
            disabled={submitted}
            style={{ marginTop: 16 }}
          />

          {scoringError && (
            <Text style={styles.errorText}>{scoringError}</Text>
          )}

          <Text style={styles.savedHint}>Responses are not stored on device</Text>
        </ScrollView>
      </KeyboardAvoidingView>
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
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 16, paddingBottom: 48 },
  timerWrap: { alignItems: 'center', marginBottom: 20 },
  questionWrap: {
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: colors.bg.tertiary,
    paddingVertical: 20, marginBottom: 24,
  },
  questionLabel: { ...text.labelMd, color: colors.teal[400], marginBottom: 10 },
  questionText: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 22, lineHeight: 32,
    color: colors.primary[800],
  },
  answerSection: { marginBottom: 8 },
  answerLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 10 },
  answerInput: {
    backgroundColor: colors.bg.white,
    borderWidth: 1.5, borderColor: colors.bg.tertiary,
    borderRadius: 12, padding: 16,
    ...text.bodyLg,
    color: colors.primary[800],
    minHeight: 180,
    lineHeight: 26,
  },
  charCount: { ...text.caption, color: colors.neutral[300], textAlign: 'right', marginTop: 6 },
  errorText: { ...text.bodySm, color: colors.error, textAlign: 'center', marginTop: 12 },
  savedHint: { ...text.caption, color: colors.neutral[300], textAlign: 'center', marginTop: 12 },
});
