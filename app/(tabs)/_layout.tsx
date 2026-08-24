import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { colors, text } from '../../src/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { previewTabs } from '../../src/navigation/tabConfig';

function TabIcon({ focused, station, label }: { focused: boolean; station: string; label: string }) {
  return (
    <View style={[styles.tabItem, focused && styles.tabItemActive]}>
      <Text style={[styles.station, focused && styles.stationActive]}>{station}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

export default function TabLayout() {
  const { session, profile, loading } = useAuthStore();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.teal[400]} size="large" />
      </View>
    );
  }
  if (!session) return <Redirect href="/(auth)/login" />;
  if (!profile?.onboarding_complete) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg.white,
          borderTopColor: colors.primary[800],
          borderTopWidth: 2,
          height: 72,
          paddingBottom: 6,
        },
        tabBarShowLabel: false,
      }}
    >
      {previewTabs.map(tab => (
        <Tabs.Screen
          key={tab.route}
          name={tab.route}
          options={{
            title: tab.label,
            tabBarAccessibilityLabel: `${tab.station} ${tab.label}`,
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} station={tab.station} label={tab.label} />
            ),
          }}
        />
      ))}
      <Tabs.Screen
        name="questions"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="tutor"
        options={{ href: null }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.primary },
  tabItem: {
    minWidth: 84,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 6,
    borderTopColor: 'transparent',
  },
  tabItemActive: { borderTopColor: colors.teal[400] },
  station: {
    ...text.headingSm,
    color: colors.neutral[500],
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
  },
  stationActive: { color: colors.primary[900] },
  tabLabel: {
    ...text.labelMd,
    color: colors.neutral[600],
    textTransform: 'uppercase',
  },
  tabLabelActive: { color: colors.primary[900] },
});
