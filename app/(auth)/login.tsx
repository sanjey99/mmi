import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/authStore';
import { FloatingInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { LegalFooter } from '../../src/components/legal/LegalFooter';
import { colors, text } from '../../src/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const signIn = useAuthStore(s => s.signIn);

  const validate = () => {
    const e: typeof errors = {};
    if (!email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setAuthError(null);
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace('/');
    } catch {
      setAuthError('Email or password was not accepted. Check the details or request a password reset.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Posted briefing-wall ruling */}
      <View style={styles.bgLines} pointerEvents="none">
        {Array.from({ length: 40 }).map((_, i) => (
          <View key={i} style={[styles.bgLine, { top: i * 24 }]} />
        ))}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={styles.container}>
          <View style={styles.logoWrap}>
            <Text style={styles.stationNumber}>00</Text>
            <Text style={styles.logoText}>INTERVIEW STATION</Text>
            <Text style={styles.logoSub}>Interview practice · candidate circuit</Text>
          </View>

          {authError ? (
            <InlineNotice title="Sign in failed" message={authError} tone="error" />
          ) : null}

          <Text style={styles.formTitle}>Enter the circuit</Text>
          <Text style={styles.formIntro}>Sign in with your account. If you were invited, open your invitation email to set your password first.</Text>
          <FloatingInput
            label="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            error={errors.email}
            autoComplete="email"
          />
          <FloatingInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            error={errors.password}
          />

          <Button label="Enter circuit" onPress={handleLogin} loading={loading} style={styles.btn} />
          <TouchableOpacity accessibilityRole="link" onPress={() => router.push('/forgot-password' as never)} disabled={loading} style={styles.resetLink}><Text style={styles.resetLinkText}>Forgot password?</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="link" onPress={() => router.push('/signup')} disabled={loading} style={styles.resetLink}><Text style={styles.resetLinkText}>Create an account</Text></TouchableOpacity>
          <Text style={styles.accessNote}>New accounts need email confirmation before sign in.</Text>
          <LegalFooter />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  bgLines: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  bgLine: {
    position: 'absolute', left: 0, right: 0,
    height: 1, backgroundColor: colors.primary[800], opacity: 0.04,
  },
  kav: { flex: 1 },
  container: {
    flex: 1, justifyContent: 'center', width: '100%', maxWidth: 520,
    alignSelf: 'center', paddingHorizontal: 28, paddingBottom: 32,
  },
  logoWrap: {
    alignItems: 'flex-start', marginBottom: 34,
    borderBottomWidth: 8, borderBottomColor: colors.teal[400], paddingBottom: 16,
  },
  stationNumber: { ...text.displayXl, color: colors.teal[600], fontVariant: ['tabular-nums'] },
  logoText: {
    ...text.displayLg, color: colors.primary[900], letterSpacing: 0.6,
  },
  logoSub: { ...text.labelMd, color: colors.neutral[600], marginTop: 4, textTransform: 'uppercase' },
  formTitle: { ...text.headingLg, color: colors.primary[900], marginTop: 24 },
  formIntro: { ...text.bodyMd, color: colors.neutral[600], marginTop: 4, marginBottom: 20 },
  btn: { marginTop: 8, marginBottom: 16 },
  accessNote: { ...text.caption, color: colors.neutral[600], maxWidth: 420 },
  resetLink: { alignSelf: 'flex-start', paddingVertical: 10, marginBottom: 12 },
  resetLinkText: { ...text.bodyMd, color: colors.teal[600], textDecorationLine: 'underline' },
});
