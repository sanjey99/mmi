import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AuthActionShell, authActionStyles } from '../../src/components/auth/AuthActionShell';
import { FloatingInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { SignupError, SIGNUP_CONFIRMATION_MESSAGE } from '../../src/features/auth/publicSignup';
import { publicSignupService } from '../../src/features/auth/publicSignupService';
import { AuthCaptcha, useAuthCaptcha } from '../../src/components/auth/AuthCaptcha';
import { AuthCaptchaError } from '../../src/features/auth/captcha';

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(publicSignupService.getCooldownSeconds);
  const active = useRef(true);
  const inFlight = useRef(false);
  const captcha = useAuthCaptcha();

  useEffect(() => {
    active.current = true;
    const timer = setInterval(() => setCooldown(publicSignupService.getCooldownSeconds()), 1_000);
    return () => { active.current = false; clearInterval(timer); };
  }, []);

  const requestEmail = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErrorMessage(null);
    try {
      await captcha.controller.run(token => resending || sent
        ? publicSignupService.resendConfirmation(email, token)
        : publicSignupService.register({ email, password, confirmPassword, captchaToken: token }));
      if (active.current) setSent(true);
    } catch (error) {
      if (active.current) setErrorMessage(error instanceof SignupError || error instanceof AuthCaptchaError ? error.message : 'Registration emails are unavailable right now. Please try again later.');
    } finally {
      inFlight.current = false;
      if (active.current) {
        setPassword('');
        setConfirmPassword('');
        setCooldown(publicSignupService.getCooldownSeconds());
        setBusy(false);
      }
    }
  };

  return (
    <AuthActionShell eyebrow="ACCOUNT / REGISTRATION" title={sent ? 'Check your email' : resending ? 'Confirm your email' : 'Create your account'} intro={sent ? SIGNUP_CONFIRMATION_MESSAGE : resending ? 'Request a fresh confirmation link for your new account.' : 'Practise for your university interview. Choose a unique password, then confirm your email before signing in.'}>
      {errorMessage ? <InlineNotice title="Account email unavailable" message={errorMessage} tone="error" /> : null}
      {!sent ? <>
        <FloatingInput label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" autoCapitalize="none" autoCorrect={false} editable={!busy} />
        {!resending ? <>
          <FloatingInput label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" autoCorrect={false} editable={!busy} />
          <FloatingInput label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" autoCorrect={false} editable={!busy} />
          <Text style={authActionStyles.helper}>Use at least 12 characters. You do not need to give your date of birth or a real name to create an account.</Text>
          <Text style={authActionStyles.helper}>Your answers are private to your account. AI feedback can be wrong. Use made-up examples and leave out real patient details or anything sensitive. Read the Terms and Privacy Notice below before continuing.</Text>
        </> : null}
      </> : null}
      <Text accessibilityLiveRegion="polite" style={authActionStyles.helper}>{cooldown > 0 ? `You can request another email in ${cooldown} seconds.` : 'Email delivery may take a few minutes. Open the newest link only.'}</Text>
      <AuthCaptcha controller={captcha.controller} action={resending || sent ? 'resend' : 'signup'} />
      <Button label={sent ? 'Send another confirmation' : resending ? 'Send confirmation email' : 'Create account'} onPress={() => { void requestEmail(); }} loading={busy} disabled={cooldown > 0 || !captcha.state.canSubmit} />
      {!sent ? <Button label={resending ? 'Back to registration' : 'Already waiting for a confirmation?'} variant="secondary" disabled={busy} onPress={() => { captcha.controller.refresh(); setResending(value => !value); setErrorMessage(null); setPassword(''); setConfirmPassword(''); }} /> : null}
      <View style={authActionStyles.actions}>
        <Button label="Return to sign in" variant="secondary" disabled={busy} onPress={() => router.replace('/(auth)/login')} />
        {sent ? <Button label="Use a different email" variant="secondary" disabled={busy} onPress={() => { captcha.controller.refresh(); setSent(false); setResending(false); setEmail(''); setErrorMessage(null); }} /> : null}
      </View>
    </AuthActionShell>
  );
}
