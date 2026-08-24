import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { navigateBackOr } from '../../src/lib/navigation';
import { colors, text } from '../../src/theme';

export default function SignupScreen() {
  const returnToLogin = () => navigateBackOr(router, '/(auth)/login');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.station}>ACCESS DESK / CLOSED PREVIEW</Text>
        <Text style={styles.title}>Accounts are issued by invitation</Text>
        <Text style={styles.body}>
          Public registration is switched off while the founding team reviews the product and question bank.
        </Text>
        <InlineNotice
          title="Need access?"
          message="Ask the founding team to create or invite your named account. Never share another tester's login."
          tone="info"
        />
        <Button label="Return to sign in" onPress={returnToLogin} style={styles.button} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 620,
    padding: 28,
  },
  station: { ...text.labelMd, color: colors.teal[600], marginBottom: 14 },
  title: { ...text.displayLg, color: colors.primary[900], maxWidth: 520 },
  body: { ...text.bodyLg, color: colors.neutral[700], marginTop: 10, marginBottom: 24, maxWidth: 560 },
  button: { marginTop: 18, alignSelf: 'flex-start', minWidth: 220 },
});
