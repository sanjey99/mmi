import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AuthActionShell, authActionStyles } from '../../src/components/auth/AuthActionShell';
import { FloatingInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { EmailActionError, MIN_PASSWORD_CODE_POINTS, type EmailActionMode } from '../../src/features/auth/emailActions';
import { emailActionService } from '../../src/features/auth/emailActionService';
import { useAuthStore } from '../../src/stores/authStore';
import { colors } from '../../src/theme';

export default function SetPasswordScreen() {
  const [mode, setMode] = useState<EmailActionMode | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const refreshProfile = useAuthStore((state) => state.refreshProfile);
  const signOut = useAuthStore((state) => state.signOut);

  useEffect(() => {
    let active = true;
    void emailActionService.getPendingAction().then((pending) => {
      if (active) setMode(pending?.mode ?? null);
    }).catch(() => {
      if (active) setErrorMessage('Your password link could not be verified. Request a new link and try again.');
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const savePassword = async () => {
    if (saving || leaving || mode === null) return;
    const nextErrors: typeof errors = {};
    if (Array.from(password).length < MIN_PASSWORD_CODE_POINTS) nextErrors.password = 'Use at least 12 characters.';
    if (confirmPassword !== password) nextErrors.confirmPassword = 'The passwords do not match.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      await emailActionService.updatePassword({ password, confirmPassword });
      setPassword('');
      setConfirmPassword('');
      await refreshProfile().catch(() => undefined);
      router.replace('/');
    } catch (reason: unknown) {
      setErrorMessage(reason instanceof EmailActionError ? reason.message : 'Your password could not be saved. Please try again.');
      if (reason instanceof EmailActionError && reason.code === 'session_required') setMode(null);
    } finally {
      setSaving(false);
    }
  };

  const backToSignIn = async () => {
    if (saving || leaving) return;
    setLeaving(true);
    setErrorMessage(null);
    try {
      await signOut();
      await emailActionService.clearPendingAction();
      router.replace('/(auth)/login');
    } catch {
      setErrorMessage('We could not sign you out. Please try again.');
    } finally {
      setLeaving(false);
    }
  };

  return (
    <AuthActionShell eyebrow="BETA / ACCOUNT ACCESS" title={mode === 'invite' ? 'Set your password' : 'Choose a new password'} intro="Use a unique password with at least 12 characters to protect your Interview Station account.">
      {checking ? <View style={authActionStyles.loading} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.teal[600]} accessibilityLabel="Checking password access" /><Text style={authActionStyles.status}>Checking your verified link…</Text></View> : mode === null ? <>
        <InlineNotice title="Password link required" message={errorMessage ?? 'Open a valid invitation or password reset email to choose your password. The link may have expired or already been used.'} tone="error" />
        <View style={authActionStyles.actions}><Button label="Request a new reset link" onPress={() => router.replace('/forgot-password' as never)} /><Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/(auth)/login')} /></View>
      </> : <>
        {errorMessage ? <InlineNotice title="Password not saved" message={errorMessage} tone="error" /> : null}
        <FloatingInput label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" autoCorrect={false} editable={!saving && !leaving} error={errors.password} />
        <FloatingInput label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" autoCorrect={false} editable={!saving && !leaving} error={errors.confirmPassword} onSubmitEditing={() => { void savePassword(); }} />
        <Text style={authActionStyles.helper}>Your password is saved only when you select the button below.</Text>
        <Button label="Save password and continue" onPress={() => { void savePassword(); }} loading={saving} disabled={leaving} />
        <Button label="Back to sign in" variant="secondary" disabled={saving} loading={leaving} onPress={() => { void backToSignIn(); }} />
      </>}
    </AuthActionShell>
  );
}
