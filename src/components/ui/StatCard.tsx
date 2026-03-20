import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, layout, shadows, text } from '../../theme';

interface StatCardProps {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  active?: boolean;
}

export function StatCard({ icon, label, value, sub, active }: StatCardProps) {
  return (
    <View style={[styles.card, active && styles.cardActive, shadows.sm]}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      <Text style={[styles.value, active && styles.valueActive]}>{value}</Text>
      {!!sub && <Text style={styles.sub}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.bg.white,
    borderRadius: layout.cardRadius,
    padding: 14,
  },
  cardActive: {
    backgroundColor: colors.teal[100],
    borderLeftWidth: 3,
    borderLeftColor: colors.teal[400],
  },
  icon: { fontSize: 22, marginBottom: 8 },
  label: {
    ...text.labelMd,
    color: colors.neutral[500],
    marginBottom: 4,
  },
  labelActive: { color: colors.teal[600] },
  value: {
    ...text.headingLg,
    color: colors.primary[800],
  },
  valueActive: { color: colors.teal[600] },
  sub: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
});
