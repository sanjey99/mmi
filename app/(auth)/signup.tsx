import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity, Alert, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/stores/authStore';
import { FloatingInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { colors, text } from '../../src/theme';

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const signUp = useAuthStore(s => s.signUp);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    else if (password.length < 8) e.password = 'Password must be at least 8 characters';
    if (password !== confirm) e.confirm = 'Passwords do not match';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSignUp = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await signUp(email.trim().toLowerCase(), password, name.trim());
      Alert.alert(
        'Check your email',
        'We sent a verification link to your email. Verify it then log in.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }],
      );
    } catch (e: any) {
      Alert.alert('Sign up failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.sub}>Join thousands of medical school applicants</Text>

          <FloatingInput label="Full name" value={name} onChangeText={setName} error={errors.name} autoComplete="name" />
          <FloatingInput label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" error={errors.email} autoComplete="email" />
          <FloatingInput label="Password" value={password} onChangeText={setPassword} secureTextEntry error={errors.password} />
          <FloatingInput label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry error={errors.confirm} />

          <Button label="Create Account" onPress={handleSignUp} loading={loading} style={{ marginTop: 8 }} />

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.loginLink}>Log in →</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  container: { paddingHorizontal: 32, paddingTop: 16, paddingBottom: 48 },
  back: { marginBottom: 24 },
  backText: { ...text.bodyMd, color: colors.teal[400], fontFamily: 'DMSans_500Medium' },
  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: colors.primary[800], marginBottom: 8 },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginBottom: 32 },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  loginText: { ...text.bodyMd, color: colors.neutral[500] },
  loginLink: { ...text.bodyMd, color: colors.teal[400], fontFamily: 'DMSans_500Medium' },
});
