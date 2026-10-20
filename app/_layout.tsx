import { useEffect, useRef, useState } from 'react';
import { Stack, router, usePathname } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { SourceSans3_400Regular, SourceSans3_600SemiBold } from '@expo-google-fonts/source-sans-3';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/stores/authStore';
import { captureBootstrapEmailAction, emailActionService } from '../src/features/auth/emailActionService';
import type { EmailActionMarker } from '../src/features/auth/emailActions';
import { safeInternalPath } from '../src/features/auth/emailActionBootstrap';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const init = useAuthStore(s => s.init);
  const sessionUserId = useAuthStore(s => s.session?.user.id);
  const pathname = usePathname();
  const [bootstrap] = useState(captureBootstrapEmailAction);
  const [initialPath] = useState(() => safeInternalPath(typeof window === 'undefined' ? pathname : `${window.location.pathname}${window.location.search}`));
  const [authBootReady, setAuthBootReady] = useState(false);
  const [checkedAccount, setCheckedAccount] = useState<{ userId: string | undefined } | null>(null);
  const [pendingAction, setPendingAction] = useState<EmailActionMarker | null>(null);
  const restoredEntry = useRef(false);
  const routesReady = authBootReady && checkedAccount !== null && checkedAccount.userId === sessionUserId;
  const passwordSetupRequired = routesReady && pendingAction !== null;

  const [fontsLoaded, fontError] = useFonts({
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    SourceSans3_400Regular,
    SourceSans3_600SemiBold,
  });

  useEffect(() => {
    let active = true;
    const unsubscribe = emailActionService.subscribe(pending => {
      if (active) setPendingAction(pending);
    });
    const restore = async () => {
      if (bootstrap) {
        try { await bootstrap; } catch { /* The callback screen shows the safe error. */ }
      }
      try { await init(); } finally { if (active) setAuthBootReady(true); }
    };
    void restore().catch(() => { /* Account screens retain their safe unavailable states. */ });
    return () => { active = false; unsubscribe(); };
  }, [bootstrap, init]);

  useEffect(() => {
    if (bootstrap && (fontsLoaded || fontError)) router.replace('/auth/callback' as never);
  }, [bootstrap, fontError, fontsLoaded]);

  useEffect(() => {
    if (!authBootReady) return;
    let active = true;
    void emailActionService.getPendingAction().then(pending => {
      if (active) {
        setPendingAction(pending);
        setCheckedAccount({ userId: sessionUserId });
      }
    }).catch(() => {
      if (active) {
        // Preserve setup on transient failures instead of exposing data routes.
        setPendingAction(emailActionService.peekPendingAction());
        setCheckedAccount({ userId: sessionUserId });
      }
    });
    return () => { active = false; };
  }, [authBootReady, sessionUserId]);

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    if (passwordSetupRequired && !['/set-password', '/auth/callback', '/terms', '/privacy'].includes(pathname)) {
      router.replace('/set-password' as never);
    } else if (routesReady && !passwordSetupRequired && !restoredEntry.current) {
      restoredEntry.current = true;
      if (!bootstrap && !['/auth/callback', '/set-password', '/forgot-password', '/login', '/signup', '/terms', '/privacy'].includes(initialPath.split('?')[0])) {
        router.replace(initialPath as never);
      }
    }
  }, [bootstrap, fontError, fontsLoaded, initialPath, passwordSetupRequired, pathname, routesReady]);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#F7F8F6" />
        <View style={{ flex: 1 }} accessibilityElementsHidden={!routesReady && !bootstrap} importantForAccessibility={!routesReady && !bootstrap ? 'no-hide-descendants' : 'auto'}>
          <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="terms" />
          <Stack.Screen name="privacy" />
          <Stack.Protected guard={routesReady && !passwordSetupRequired}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="practice" />
            <Stack.Screen name="admin" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="profile" />
            <Stack.Screen name="cofounder-feedback" />
          </Stack.Protected>
          </Stack>
        </View>
        {!routesReady && !bootstrap ? <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8F6' }]}>
          <ActivityIndicator accessibilityLabel="Restoring account access" />
        </View> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
