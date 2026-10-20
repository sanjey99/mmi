import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LegalFooter } from '../legal/LegalFooter';
import { colors, text } from '../../theme';

type AuthActionShellProps = Readonly<{
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}>;

export function AuthActionShell({ eyebrow, title, intro, children }: AuthActionShellProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <View style={styles.brand}><Text style={styles.wordmark}>INTERVIEW STATION</Text><Text style={styles.eyebrow}>{eyebrow}</Text></View>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <Text style={styles.intro}>{intro}</Text>
            <View style={styles.form}>{children}</View>
            <LegalFooter />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const authActionStyles = StyleSheet.create({
  status: { ...text.bodyMd, color: colors.neutral[700] },
  actions: { gap: 12, marginTop: 8 },
  helper: { ...text.bodySm, color: colors.neutral[600], marginBottom: 8 },
  loading: { alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  container: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 28, gap: 12 },
  brand: { borderBottomWidth: 8, borderBottomColor: colors.teal[400], paddingBottom: 16, marginBottom: 16 },
  wordmark: { ...text.headingLg, color: colors.primary[900], letterSpacing: 0.6 },
  eyebrow: { ...text.labelMd, color: colors.neutral[600], marginTop: 6 },
  title: { ...text.displayLg, color: colors.primary[900] },
  intro: { ...text.bodyMd, color: colors.neutral[600], marginBottom: 8 },
  form: { gap: 12, marginBottom: 12 },
});
