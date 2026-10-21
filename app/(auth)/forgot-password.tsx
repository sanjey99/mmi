import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AuthActionShell, authActionStyles } from '../../src/components/auth/AuthActionShell';
import { FloatingInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { EmailActionError, PASSWORD_RESET_SENT_MESSAGE } from '../../src/features/auth/emailActions';
import { emailActionService } from '../../src/features/auth/emailActionService';
import { AuthCaptcha, useAuthCaptcha } from '../../src/components/auth/AuthCaptcha';
import { AuthCaptchaError } from '../../src/features/auth/captcha';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const captcha = useAuthCaptcha();
  const inFlight = useRef(false);

  const requestReset = async () => {
    if (inFlight.current) return;
    const normalizedEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(undefined);
    inFlight.current = true;
    setErrorMessage(null);
    setLoading(true);
    try {
      await captcha.controller.run(token => emailActionService.requestPasswordReset(normalizedEmail, token));
      setSent(true);
    } catch (reason: unknown) {
      setErrorMessage(reason instanceof EmailActionError || reason instanceof AuthCaptchaError ? reason.message : 'A reset link could not be requested right now. Please try again.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <AuthActionShell eyebrow="BETA / PASSWORD RESET" title={sent ? 'Check your email' : 'Reset your password'} intro={sent ? 'You can close this page after checking your inbox.' : 'Enter the email address used for your invitation. We will send instructions if the account is eligible for a reset.'}>
      {sent ? <>
        <InlineNotice title="Reset request received" message={PASSWORD_RESET_SENT_MESSAGE} tone="success" />
        <View style={authActionStyles.actions}><Button label="Back to sign in" onPress={() => router.replace('/(auth)/login')} /><Button label="Try another email" variant="secondary" onPress={() => { captcha.controller.refresh(); setSent(false); setEmail(''); }} /></View>
      </> : <>
        {errorMessage ? <InlineNotice title="Reset request unavailable" message={errorMessage} tone="error" /> : null}
        <FloatingInput label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" autoCorrect={false} editable={!loading} error={emailError} onSubmitEditing={() => { void requestReset(); }} />
        <AuthCaptcha controller={captcha.controller} action="recovery" />
        <Button label="Send reset link" onPress={() => { void requestReset(); }} loading={loading} disabled={!captcha.state.canSubmit} />
        <Button label="Back to sign in" variant="secondary" disabled={loading} onPress={() => router.replace('/(auth)/login')} />
      </>}
    </AuthActionShell>
  );
}
