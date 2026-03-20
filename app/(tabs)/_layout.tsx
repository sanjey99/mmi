import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { colors, text } from '../../src/theme';

function TabIcon({ focused, emoji, label }: { focused: boolean; emoji: string; label: string }) {
  return (
    <View style={styles.tabItem}>
      {focused && <View style={styles.activeDot} />}
      <Text style={styles.emoji}>{emoji}</Text>
      {focused && <Text style={styles.activeLabel}>{label}</Text>}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg.white,
          borderTopColor: colors.bg.tertiary,
          height: 64,
          paddingBottom: 8,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="🏠" label="Home" />,
        }}
      />
      <Tabs.Screen
        name="practice"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="🎯" label="Practice" />,
        }}
      />
      <Tabs.Screen
        name="questions"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="📚" label="Questions" />,
        }}
      />
      <Tabs.Screen
        name="tutor"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="🎓" label="Tutor" />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} emoji="📈" label="Progress" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: { alignItems: 'center', justifyContent: 'center', paddingTop: 4, minWidth: 50 },
  activeDot: {
    position: 'absolute', top: -8,
    width: 20, height: 3,
    backgroundColor: colors.teal[400],
    borderRadius: 2,
  },
  emoji: { fontSize: 22 },
  activeLabel: {
    ...text.labelMd,
    fontSize: 9,
    color: colors.teal[400],
    marginTop: 2,
    textTransform: 'uppercase',
  },
});
