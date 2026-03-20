import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, layout, text } from '../../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  small?: boolean;
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, style, small }: ButtonProps) {
  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[
        styles.base,
        small && styles.small,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.teal[400]} />
        : <Text style={[
            styles.label,
            small && styles.labelSmall,
            variant !== 'primary' && styles.labelSecondary,
            variant === 'danger' && styles.labelDanger,
          ]}>
            {label}
          </Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: layout.buttonRadius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  small: { height: 40 },
  primary: { backgroundColor: colors.teal[400] },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.primary[800],
  },
  danger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  disabled: { opacity: 0.45 },
  label: {
    ...text.headingSm,
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  labelSmall: { fontSize: 13 },
  labelSecondary: { color: colors.primary[800] },
  labelDanger: { color: colors.error },
});
