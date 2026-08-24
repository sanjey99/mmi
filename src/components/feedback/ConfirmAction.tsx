import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { colors, text } from '../../theme';

interface ConfirmActionProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmActionProps) {
  return (
    <View accessibilityRole="alert" style={styles.panel}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <Button
          label={cancelLabel}
          variant="secondary"
          onPress={onCancel}
          disabled={busy}
          small
          style={styles.action}
        />
        <Button
          label={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          onPress={onConfirm}
          loading={busy}
          small
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 2,
    borderColor: colors.primary[800],
    backgroundColor: colors.bg.white,
    padding: 18,
    gap: 8,
  },
  title: { ...text.headingMd, color: colors.primary[900] },
  message: { ...text.bodyMd, color: colors.neutral[700] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  action: { flexGrow: 1, minWidth: 128 },
});
