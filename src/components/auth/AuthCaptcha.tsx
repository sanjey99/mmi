import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { authCaptchaConfig, AuthCaptchaError, createAuthCaptchaController, type AuthCaptchaController } from '../../features/auth/captcha';
import { loadTurnstile, type TurnstileApi } from '../../features/auth/turnstile';
import { Button } from '../ui/Button';
import { colors, text } from '../../theme';

export function useAuthCaptcha() {
  const [controller] = useState(() => createAuthCaptchaController(authCaptchaConfig));
  useFocusEffect(useCallback(() => { controller.activate(); return () => controller.deactivate(); }, [controller]));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, state };
}

const statusText = {
  disabled: '',
  loading: 'Loading the security check…',
  ready: 'Complete the security check to continue.',
  verified: 'Security check ready.',
  expired: 'The security check expired. Please try it again.',
  error: 'The security check could not complete. Please try it again.',
  unavailable: new AuthCaptchaError('unavailable').message,
  submitting: 'Submitting your request…',
};

export function AuthCaptcha({ controller, action }: Readonly<{ controller: AuthCaptchaController; action: 'login' | 'signup' | 'resend' | 'recovery' }>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const container = useRef<HTMLDivElement>(null);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused || controller.config.mode !== 'required') return;
    const generation = controller.getGeneration();
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !container.current) { controller.fail('unavailable', generation); return; }
    let active = true;
    let api: TurnstileApi | undefined;
    let widgetId: string | undefined;
    void loadTurnstile(window).then(loaded => {
      if (!active) return;
      api = loaded;
      widgetId = api.render(container.current!, {
        sitekey: controller.config.siteKey!, action, size: 'flexible', language: 'auto', tabindex: 0,
        retry: 'never', 'refresh-expired': 'manual', 'response-field': false,
        callback: token => { if (active) controller.verify(token, generation); },
        'expired-callback': () => { if (active) controller.fail('expired', generation); },
        'timeout-callback': () => { if (active) controller.fail('error', generation); },
        'error-callback': () => { if (active) controller.fail('error', generation); },
        'unsupported-callback': () => { if (active) controller.fail('unavailable', generation); },
      });
      controller.ready(generation);
    }).catch(() => { if (active) controller.fail('unavailable', generation); });
    return () => { active = false; if (api && widgetId !== undefined) { try { api.remove(widgetId); } catch { /* No provider diagnostics are exposed. */ } } };
  }, [action, controller, focused, state.revision]);

  if (controller.config.mode === 'off') return null;
  const unsupported = Platform.OS !== 'web';
  return <View style={{ gap: 10, marginBottom: 16 }}>
    {unsupported ? null : React.createElement('div', { ref: container, role: 'group', 'aria-label': 'Security check' })}
    <Text accessibilityLiveRegion="polite" style={{ ...text.bodySm, color: colors.neutral[700] }}>{unsupported ? 'Complete this security check in a web browser to continue.' : statusText[state.status]}</Text>
    {controller.config.mode === 'required' && !unsupported && ['expired', 'error', 'unavailable'].includes(state.status)
      ? <Button label="Retry security check" small variant="secondary" onPress={controller.refresh} /> : null}
  </View>;
}
