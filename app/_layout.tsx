import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/stores/authStore';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const init = useAuthStore(s => s.init);

  const [fontsLoaded, fontError] = useFonts({
    DMSerifDisplay_400Regular,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#F7F3EE" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="practice" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="onboarding" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
