import { Redirect, router } from 'expo-router';
import Constants from 'expo-constants';
import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../src/components/ui/Button';
import { ConfirmAction } from '../src/components/feedback/ConfirmAction';
import { InlineNotice } from '../src/components/feedback/InlineNotice';
import type {
  FeedbackCategory,
  FeedbackScreen,
  FeedbackSeverity,
} from '../src/features/cofounderFeedback/api';
import { sendCofounderFeedback } from '../src/lib/cofounderFeedback';
import { navigateBackOr } from '../src/lib/navigation';
import { useAuthStore } from '../src/stores/authStore';
import { colors, layout, text } from '../src/theme';

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'usability', label: 'Usability' },
  { value: 'content', label: 'Content' },
  { value: 'scoring', label: 'Scoring' },
  { value: 'idea', label: 'Idea' },
  { value: 'other', label: 'Other' },
];
const SEVERITIES: { value: FeedbackSeverity; label: string }[] = [
  { value: 'blocking', label: 'Blocking' },
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'suggestion', label: 'Suggestion' },
];
const SCREENS: { value: FeedbackScreen; label: string }[] = [
  { value: 'orientation', label: 'Orient' },
  { value: 'practice', label: 'Practice' },
  { value: 'feedback', label: 'AI feedback' },
  { value: 'progress', label: 'Progress' },
  { value: 'profile', label: 'Profile' },
  { value: 'question_desk', label: 'Question desk' },
  { value: 'ai_config', label: 'AI config' },
  { value: 'other', label: 'Other' },
];

export default function CofounderFeedbackScreen() {
  const session = useAuthStore(state => state.session);
  const [category, setCategory] = useState<FeedbackCategory>('usability');
  const [severity, setSeverity] = useState<FeedbackSeverity>('suggestion');
  const [screen, setScreen] = useState<FeedbackScreen>('orientation');
  const [message, setMessage] = useState('');
  const [allowReply, setAllowReply] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    title: string;
    message: string;
    tone: 'success' | 'error';
  } | null>(null);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  if (!session) return <Redirect href="/(auth)/login" />;

  const prepareSubmission = () => {
    if (message.trim().length < 10 || message.trim().length > 2000) {
      setNotice({
        title: 'Add more detail',
        message: 'Feedback must be between 10 and 2000 characters.',
        tone: 'error',
      });
      return;
    }
    setNotice(null);
    setConfirming(true);
  };

  const submit = async () => {
    setSaving(true);
    try {
      await sendCofounderFeedback({
        category,
        severity,
        screen,
        message,
        appVersion,
        allowReply,
      });
      setMessage('');
      setAllowReply(false);
      setConfirming(false);
      setNotice({
        title: 'Feedback received',
        message: 'Thank you. Your note is now available in the cofounder review desk.',
        tone: 'success',
      });
    } catch {
      setConfirming(false);
      setNotice({
        title: 'Feedback not sent',
        message: 'Nothing was confirmed as saved. Check your connection and try again.',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigateBackOr(router, '/(tabs)')}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>Back to orient</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>TESTER REPORT</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>CLOSED PREVIEW · PARTNER INPUT</Text>
        <Text style={styles.title}>Tell us what happened</Text>
        <Text style={styles.subtitle}>
          Be specific about what you expected and what you saw. One issue per report helps us act faster.
        </Text>

        <View style={styles.privacyNotice}>
          <Text style={styles.privacyLabel}>PRIVACY BOUNDARY</Text>
          <Text style={styles.privacyText}>
            No answers, transcripts, screenshots, tokens, or browser logs are attached.
          </Text>
        </View>

        {notice ? <InlineNotice {...notice} /> : null}
        {confirming ? (
          <ConfirmAction
            title="Send this report?"
            message={`This sends your ${severity} ${category} report for ${screen.replace('_', ' ')}. Reply permission is ${allowReply ? 'on' : 'off'}.`}
            confirmLabel="Send report"
            busy={saving}
            onConfirm={submit}
            onCancel={() => setConfirming(false)}
          />
        ) : null}

        <View style={styles.sheet}>
          <Text style={styles.sectionTitle}>01 · CLASSIFY</Text>
          <Text style={styles.fieldLabel}>CATEGORY</Text>
          <View style={styles.optionGrid}>
            {CATEGORIES.map(option => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setCategory(option.value)}
                style={[styles.option, category === option.value && styles.optionActive]}
                accessibilityState={{ selected: category === option.value }}
              >
                <Text style={styles.optionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>SEVERITY</Text>
          <View style={styles.optionGrid}>
            {SEVERITIES.map(option => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setSeverity(option.value)}
                style={[styles.option, severity === option.value && styles.optionActive]}
                accessibilityState={{ selected: severity === option.value }}
              >
                <Text style={styles.optionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>SCREEN</Text>
          <View style={styles.optionGrid}>
            {SCREENS.map(option => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setScreen(option.value)}
                style={[styles.option, screen === option.value && styles.optionActive]}
                accessibilityState={{ selected: screen === option.value }}
              >
                <Text style={styles.optionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>02 · DESCRIBE</Text>
          <Text style={styles.fieldLabel}>WHAT HAPPENED?</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={2000}
            placeholder="What did you try, what did you expect, and what happened instead?"
            placeholderTextColor={colors.neutral[400]}
            style={styles.messageInput}
          />
          <Text style={styles.characterCount}>{message.length} / 2000</Text>

          <TouchableOpacity
            onPress={() => setAllowReply(current => !current)}
            style={styles.replyRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allowReply }}
          >
            <View style={[styles.checkbox, allowReply && styles.checkboxChecked]}>
              <Text style={styles.checkmark}>{allowReply ? 'YES' : ''}</Text>
            </View>
            <View style={styles.replyCopy}>
              <Text style={styles.replyTitle}>Allow a cofounder to follow up</Text>
              <Text style={styles.replyText}>If off, your account ID is omitted from the admin review response.</Text>
            </View>
          </TouchableOpacity>

          <Button
            label="Review report"
            onPress={prepareSubmission}
            disabled={saving}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[800],
  },
  backText: { ...text.labelMd, color: colors.primary[800], minWidth: 112, textTransform: 'uppercase' },
  headerTitle: { ...text.labelMd, color: colors.primary[800] },
  headerSpacer: { width: 112 },
  content: { paddingHorizontal: layout.screenPaddingH, paddingTop: 28, paddingBottom: 56 },
  eyebrow: { ...text.labelMd, color: colors.neutral[500], marginBottom: 5 },
  title: { ...text.displayLg, color: colors.primary[800] },
  subtitle: { ...text.bodyMd, color: colors.neutral[500], lineHeight: 23, marginTop: 5, maxWidth: 680 },
  privacyNotice: {
    borderLeftWidth: 8,
    borderColor: colors.teal[400],
    backgroundColor: colors.bg.white,
    padding: 16,
    marginVertical: 20,
  },
  privacyLabel: { ...text.labelMd, color: colors.primary[800], marginBottom: 4 },
  privacyText: { ...text.bodySm, color: colors.neutral[600], lineHeight: 20 },
  sheet: {
    borderWidth: 1,
    borderColor: colors.primary[800],
    backgroundColor: colors.bg.white,
    padding: 20,
  },
  sectionTitle: { ...text.headingMd, color: colors.primary[800], marginBottom: 14, marginTop: 4 },
  fieldLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 7, marginTop: 12 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: colors.bg.white,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  optionActive: { borderWidth: 2, borderColor: colors.primary[800], backgroundColor: colors.teal[200] },
  optionText: { ...text.bodySm, color: colors.primary[800] },
  messageInput: {
    ...text.bodyMd,
    minHeight: 150,
    borderWidth: 1,
    borderColor: colors.primary[800],
    color: colors.primary[800],
    backgroundColor: colors.bg.primary,
    padding: 14,
    textAlignVertical: 'top',
  },
  characterCount: { ...text.caption, color: colors.neutral[500], textAlign: 'right', marginTop: 5 },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.neutral[300],
    paddingVertical: 14,
    marginVertical: 20,
  },
  checkbox: {
    width: 42,
    height: 32,
    borderWidth: 1,
    borderColor: colors.primary[800],
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.teal[400] },
  checkmark: { ...text.labelMd, color: colors.primary[900] },
  replyCopy: { flex: 1 },
  replyTitle: { ...text.headingSm, color: colors.primary[800] },
  replyText: { ...text.bodySm, color: colors.neutral[500], marginTop: 2 },
});
