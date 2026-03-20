import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/authStore';
import { FloatingInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { colors, text } from '../../src/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Sign in failed', e.message ?? 'Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Graph paper background lines */}
      <View style={styles.bgLines} pointerEvents="none">
        {Array.from({ length: 40 }).map((_, i) => (
          <View key={i} style={[styles.bgLine, { top: i * 24 }]} />
        ))}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={styles.container}>
          {/* Logo */}
          <View style={styles.logoWrap}>
            <Text style={styles.logoText}>Interview Station</Text>
            <Text style={styles.logoSub}>Ace your medical interview</Text>
          </View>

          {/* Form */}
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

          <TouchableOpacity style={styles.forgot}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <Button label="Log In" onPress={handleLogin} loading={loading} style={styles.btn} />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.signupRow}>
            <Text style={styles.signupText}>New here? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
              <Text style={styles.signupLink}>Sign up →</Text>
            </TouchableOpacity>
          </View>
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
    flex: 1, justifyContent: 'center',
    paddingHorizontal: 32, paddingBottom: 32,
  },
  logoWrap: { alignItems: 'center', marginBottom: 48 },
  logoText: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 32, color: colors.primary[800], letterSpacing: -0.5,
  },
  logoSub: { ...text.bodySm, color: colors.neutral[500], marginTop: 4 },
  forgot: { alignSelf: 'flex-end', marginBottom: 20, marginTop: -4 },
  forgotText: { ...text.bodySm, color: colors.teal[400], fontFamily: 'DMSans_500Medium' },
  btn: { marginBottom: 20 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.bg.tertiary },
  dividerText: { ...text.caption, color: colors.neutral[300] },
  signupRow: { flexDirection: 'row', justifyContent: 'center' },
  signupText: { ...text.bodyMd, color: colors.neutral[500] },
  signupLink: { ...text.bodyMd, color: colors.teal[400], fontFamily: 'DMSans_500Medium' },
});
