import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AuthActionShell, authActionStyles } from '../../../src/components/auth/AuthActionShell';
import { Button } from '../../../src/components/ui/Button';
import { InlineNotice } from '../../../src/components/feedback/InlineNotice';
import { EmailActionError } from '../../../src/features/auth/emailActions';
import { captureBootstrapEmailAction, emailActionService, getBootstrapEmailAction } from '../../../src/features/auth/emailActionService';
import { colors } from '../../../src/theme';

export default function AuthCallbackScreen() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const verification = useRef<ReturnType<typeof emailActionService.handleCallback> | null>(null);

  useEffect(() => {
    let active = true;
    if (verification.current === null) {
      verification.current = getBootstrapEmailAction() ?? captureBootstrapEmailAction()
        ?? Promise.reject(new EmailActionError('invalid_link'));
    }
    void verification.current.then(() => {
      if (active) router.replace('/set-password' as never);
    }).catch((reason: unknown) => {
      if (active) setErrorMessage(reason instanceof EmailActionError
        ? reason.message
        : 'This invitation or password reset link could not be verified. Request a new link and try again.');
    });
    return () => { active = false; };
  }, []);

  return (
    <AuthActionShell eyebrow="BETA / EMAIL VERIFICATION" title={errorMessage ? 'Email link unavailable' : 'Checking your email link'} intro={errorMessage ? 'Invitation and password reset links can expire or be used only once.' : 'Please wait while we securely verify your invitation or password reset link.'}>
      {errorMessage ? <>
        <InlineNotice title="Link could not be verified" message={errorMessage} tone="error" />
        <Text style={authActionStyles.helper}>Request another password reset below. If you need a new invitation, ask the team that invited you.</Text>
        <View style={authActionStyles.actions}>
          <Button label="Request a new reset link" onPress={() => router.replace('/forgot-password' as never)} />
          <Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/(auth)/login')} />
        </View>
      </> : <View style={authActionStyles.loading} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.teal[600]} accessibilityLabel="Verifying email link" />
        <Text style={authActionStyles.status}>Verifying your link…</Text>
      </View>}
    </AuthActionShell>
  );
}
