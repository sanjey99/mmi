import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { Button } from '../ui/Button';
import { colors, text } from '../../theme';
import { reportRenderFailure } from '../../features/operations/runtimeService';

export function AppErrorBoundary({ retry }: ErrorBoundaryProps) {
  useEffect(reportRenderFailure, []);
  return <View style={styles.screen}>
    <Text accessibilityRole="header" style={styles.title}>This screen could not open</Text>
    <Text style={styles.copy}>Try opening it again. If the problem continues, contact the team that invited you.</Text>
    <Button label="Try again" onPress={retry} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 20, backgroundColor: colors.bg.primary },
  title: { ...text.headingLg, color: colors.primary[800] },
  copy: { ...text.bodyMd, color: colors.neutral[600], maxWidth: 560 },
});
