import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, text } from '../../src/theme';

export default function LegacyPracticeSessionRedirect() {
  useEffect(() => {
    router.replace('/(tabs)/practice');
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centered}>
        <Text style={styles.title}>Opening MMI practice</Text>
        <Text style={styles.body}>Taking you to the 11-minute station.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  centered: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  title: { ...text.headingLg, color: colors.primary[900] },
  body: { ...text.bodyMd, color: colors.neutral[600] },
});
