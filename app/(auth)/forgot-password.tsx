import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AuthActionShell, authActionStyles } from '../../src/components/auth/AuthActionShell';
import { FloatingInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { EmailActionError, PASSWORD_RESET_SENT_MESSAGE } from '../../src/features/auth/emailActions';
import { emailActionService } from '../../src/features/auth/emailActionService';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestReset = async () => {
    if (loading) return;
    const normalizedEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(undefined);
    setErrorMessage(null);
    setLoading(true);
    try {
      await emailActionService.requestPasswordReset(normalizedEmail);
      setSent(true);
    } catch (reason: unknown) {
      setErrorMessage(reason instanceof EmailActionError ? reason.message : 'A reset link could not be requested right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthActionShell eyebrow="BETA / PASSWORD RESET" title={sent ? 'Check your email' : 'Reset your password'} intro={sent ? 'You can close this page after checking your inbox.' : 'Enter the email address used for your invitation. We will send instructions if the account is eligible for a reset.'}>
      {sent ? <>
        <InlineNotice title="Reset request received" message={PASSWORD_RESET_SENT_MESSAGE} tone="success" />
        <View style={authActionStyles.actions}><Button label="Back to sign in" onPress={() => router.replace('/(auth)/login')} /><Button label="Try another email" variant="secondary" onPress={() => { setSent(false); setEmail(''); }} /></View>
      </> : <>
        {errorMessage ? <InlineNotice title="Reset request unavailable" message={errorMessage} tone="error" /> : null}
        <FloatingInput label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" autoCorrect={false} editable={!loading} error={emailError} onSubmitEditing={() => { void requestReset(); }} />
        <Button label="Send reset link" onPress={() => { void requestReset(); }} loading={loading} />
        <Button label="Back to sign in" variant="secondary" disabled={loading} onPress={() => router.replace('/(auth)/login')} />
      </>}
    </AuthActionShell>
  );
}
