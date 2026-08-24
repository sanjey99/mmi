import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, layout, text } from '../../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, style, small }: ButtonProps) {
  const handlePress = async () => {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
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
        ? <ActivityIndicator color={variant === 'primary' ? colors.primary[900] : colors.primary[800]} />
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
    borderWidth: 2,
    borderColor: colors.primary[900],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  small: { height: 40 },
  primary: { backgroundColor: colors.teal[400] },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary[800],
  },
  danger: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.error,
  },
  disabled: { opacity: 0.45 },
  label: {
    ...text.headingSm,
    color: colors.primary[900],
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  labelSmall: { fontSize: 13 },
  labelSecondary: { color: colors.primary[800] },
  labelDanger: { color: colors.error },
});
