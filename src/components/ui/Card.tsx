import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, layout } from '../../theme';

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
      elevated && styles.cardElevated,
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
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  cardTeal: {
    backgroundColor: colors.teal[100],
    borderColor: colors.teal[600],
  },
  cardNavy: {
    backgroundColor: colors.primary[800],
    borderColor: colors.primary[800],
  },
  cardElevated: {
    borderWidth: 2,
    borderColor: colors.primary[800],
  },
});
