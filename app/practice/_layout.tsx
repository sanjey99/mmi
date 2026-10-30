import { Redirect, Stack } from 'expo-router';
import { colors } from '../../src/theme';
import { useAuthStore } from '../../src/stores/authStore';

export default function PracticeLayout() {
  const session = useAuthStore(state => state.session);
  if (!session) return <Redirect href="/(auth)/login" />;
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
