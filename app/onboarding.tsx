import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/stores/authStore';
import { Button } from '../src/components/ui/Button';
import { colors, text } from '../src/theme';

const UNIVERSITIES = ['Oxford', 'Cambridge', 'UCL', 'Imperial', 'King\'s', 'Edinburgh', 'Manchester', 'Bristol', 'Leeds', 'Other'];
const YEARS = [2026, 2027, 2028];

export default function OnboardingScreen() {
  const [university, setUniversity] = useState('');
  const [year, setYear] = useState(2026);
  const [loading, setLoading] = useState(false);
  const updateProfile = useAuthStore(s => s.updateProfile);

  const handleContinue = async () => {
    if (!university) { Alert.alert('Please select your target university'); return; }
    setLoading(true);
    try {
      await updateProfile({
        university_target: university.toLowerCase(),
        entry_year: year,
        onboarding_complete: true,
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.emoji}>🎓</Text>
        <Text style={styles.title}>Welcome to Interview Station</Text>
        <Text style={styles.sub}>Tell us about your application so we can personalise your practice.</Text>

        <Text style={styles.sectionLabel}>TARGET UNIVERSITY</Text>
        <View style={styles.grid}>
          {UNIVERSITIES.map(u => (
            <TouchableOpacity
              key={u}
              style={[styles.chip, university === u && styles.chipActive]}
              onPress={() => setUniversity(u)}
            >
              <Text style={[styles.chipText, university === u && styles.chipTextActive]}>{u}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>ENTRY YEAR</Text>
        <View style={styles.yearRow}>
          {YEARS.map(y => (
            <TouchableOpacity
              key={y}
              style={[styles.yearChip, year === y && styles.chipActive]}
              onPress={() => setYear(y)}
            >
              <Text style={[styles.chipText, year === y && styles.chipTextActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Button label="Let's Start →" onPress={handleContinue} loading={loading} style={{ marginTop: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  container: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 48 },
  emoji: { fontSize: 48, textAlign: 'center', marginBottom: 16 },
  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 26, color: colors.primary[800], textAlign: 'center', marginBottom: 8 },
  sub: { ...text.bodyMd, color: colors.neutral[500], textAlign: 'center', marginBottom: 36 },
  sectionLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  yearRow: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 99, borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white,
  },
  chipActive: { backgroundColor: colors.teal[400], borderColor: colors.teal[400] },
  chipText: { ...text.bodyMd, color: colors.neutral[700] },
  chipTextActive: { color: '#fff', fontFamily: 'DMSans_500Medium' },
  yearChip: {
    flex: 1, paddingVertical: 10, borderRadius: 99,
    borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white, alignItems: 'center',
  },
});
