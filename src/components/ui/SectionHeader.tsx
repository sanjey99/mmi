import React from 'react';
import { Text, StyleSheet, ViewStyle, View } from 'react-native';
import { colors, text } from '../../theme';

interface SectionHeaderProps {
  title: string;
  style?: ViewStyle;
}

export function SectionHeader({ title, style }: SectionHeaderProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12, marginTop: 24 },
  title: {
    ...text.labelMd,
    color: colors.neutral[500],
  },
});
