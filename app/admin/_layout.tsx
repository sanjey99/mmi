import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { colors } from '../../src/theme';

export default function AdminLayout() {
  const { profile, loading } = useAuthStore();

  useEffect(() => {
    if (!loading && !profile?.is_admin) {
      router.replace('/(tabs)');
    }
  }, [loading, profile]);

  if (loading || !profile?.is_admin) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.primary }}>
        <ActivityIndicator color={colors.teal[400]} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.primary },
        animation: 'slide_from_right',
      }}
    />
  );
}
