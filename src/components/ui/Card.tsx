import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, layout, shadows } from '../../theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'teal' | 'navy';
  elevated?: boolean;
}

export function Card({ children, style, variant = 'default', elevated }: CardProps) {
  return (
    <View style={[
      styles.card,
      variant === 'teal' && styles.cardTeal,
      variant === 'navy' && styles.cardNavy,
      elevated && shadows.md,
      style,
    ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderRadius: layout.cardRadius,
    padding: layout.cardPadding,
    ...shadows.sm,
  },
  cardTeal: {
    backgroundColor: colors.teal[100],
    borderLeftWidth: 3,
    borderLeftColor: colors.teal[400],
  },
  cardNavy: {
    backgroundColor: colors.primary[800],
  },
});
