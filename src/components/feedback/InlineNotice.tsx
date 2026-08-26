import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, text } from '../../theme';

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

interface InlineNoticeProps {
  title: string;
  message?: string;
  tone?: NoticeTone;
}

const toneColors: Record<NoticeTone, string> = {
  info: colors.info,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
};

export function InlineNotice({ title, message, tone = 'info' }: InlineNoticeProps) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: toneColors[tone] }]}
    >
      <Text style={[styles.title, { color: toneColors[tone] }]}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderWidth: 1,
    backgroundColor: colors.bg.white,
    padding: 14,
    gap: 4,
  },
  title: { ...text.headingSm },
  message: { ...text.bodySm, color: colors.neutral[700] },
});
