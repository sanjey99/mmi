import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AuthActionShell, authActionStyles } from '../../../src/components/auth/AuthActionShell';
import { Button } from '../../../src/components/ui/Button';
import { InlineNotice } from '../../../src/components/feedback/InlineNotice';
import { EmailActionError } from '../../../src/features/auth/emailActions';
import { captureBootstrapEmailAction, emailActionService, getBootstrapEmailAction } from '../../../src/features/auth/emailActionService';
import { useAuthStore } from '../../../src/stores/authStore';
import { colors } from '../../../src/theme';

export default function AuthCallbackScreen() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedUserId, setConfirmedUserId] = useState<string | null>(null);
  const sessionUserId = useAuthStore(state => state.session?.user.id);
  const authLoading = useAuthStore(state => state.loading);
  const verification = useRef<ReturnType<typeof emailActionService.handleCallback> | null>(null);

  useEffect(() => {
    let active = true;
    if (verification.current === null) {
      verification.current = getBootstrapEmailAction() ?? captureBootstrapEmailAction()
        ?? Promise.reject(new EmailActionError('invalid_link'));
    }
    void verification.current.then((result) => {
      if (!active) return;
      if (result.mode === 'signup') setConfirmedUserId(result.userId);
      else router.replace('/set-password' as never);
    }).catch((reason: unknown) => {
      if (active) setErrorMessage(reason instanceof EmailActionError
        ? reason.message
        : 'This email link could not be verified. Request a new link and try again.');
    });
    return () => { active = false; };
  }, []);

  return (
    <AuthActionShell eyebrow="ACCOUNT / EMAIL VERIFICATION" title={errorMessage ? 'Email link unavailable' : confirmedUserId ? 'Email confirmed' : 'Checking your email link'} intro={errorMessage ? 'Confirmation, invitation, and password reset links can expire or be used only once.' : confirmedUserId ? 'Your email is confirmed. Continue to finish setting up your practice account.' : 'Please wait while we securely verify your email link.'}>
      {errorMessage ? <>
        <InlineNotice title="Link could not be verified" message={errorMessage} tone="error" />
        <Text style={authActionStyles.helper}>For a new account, request another confirmation email. If you need a new invitation, ask the team that invited you.</Text>
        <View style={authActionStyles.actions}>
          <Button label="Request a confirmation email" variant="secondary" onPress={() => router.replace('/signup' as never)} />
          <Button label="Request a new reset link" onPress={() => router.replace('/forgot-password' as never)} />
          <Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/(auth)/login')} />
        </View>
      </> : confirmedUserId ? <>
        <InlineNotice title="Your account is ready" message="Your chosen password is already set. You do not need to choose it again." tone="success" />
        <Button label="Continue to the circuit" disabled={authLoading || sessionUserId !== confirmedUserId} onPress={() => router.replace('/')} />
        <Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/(auth)/login')} />
      </> : <View style={authActionStyles.loading} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.teal[600]} accessibilityLabel="Verifying email link" />
        <Text style={authActionStyles.status}>Verifying your link…</Text>
      </View>}
    </AuthActionShell>
  );
}
