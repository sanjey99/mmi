// Root redirect — Expo Router entry point
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/stores/authStore';
import { View, ActivityIndicator } from 'react-native';
import { colors } from '../src/theme';

export default function Index() {
  const { session, loading, profile } = useAuthStore();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.primary }}>
        <ActivityIndicator color={colors.teal[400]} size="large" />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;
  if (session && profile && !profile.onboarding_complete) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
