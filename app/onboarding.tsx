import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/stores/authStore';
import { Button } from '../src/components/ui/Button';
import { InlineNotice } from '../src/components/feedback/InlineNotice';
import { LegalFooter } from '../src/components/legal/LegalFooter';
import { colors, text } from '../src/theme';

const UNIVERSITIES = ['Oxford', 'Cambridge', 'UCL', 'Imperial', 'King\'s', 'Edinburgh', 'Manchester', 'Bristol', 'Leeds', 'Other'];
const YEARS = [2026, 2027, 2028];

export default function OnboardingScreen() {
  const [university, setUniversity] = useState('');
  const [year, setYear] = useState(2026);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const updateProfile = useAuthStore(s => s.updateProfile);
  const session = useAuthStore(s => s.session);
  const authLoading = useAuthStore(s => s.loading);

  const handleContinue = async () => {
    if (!university) {
      setErrorMessage('Choose a target university before entering the practice circuit.');
      return;
    }
    if (!acknowledged) {
      setErrorMessage('Confirm that you are 18 or older and have read the beta Terms and Privacy Notice.');
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      await updateProfile({
        university_target: university.toLowerCase(),
        entry_year: year,
        onboarding_complete: true,
      });
      router.replace('/(tabs)');
    } catch {
      setErrorMessage('Your orientation details were not saved. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return <View style={styles.safe}><ActivityIndicator accessibilityLabel="Loading your account" /></View>;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.station}>01 / ORIENT</Text>
        <Text style={styles.title}>Set your candidate brief</Text>
        <Text style={styles.sub}>Tell us about your application so we can personalise your practice. This invitation-only beta is for adults aged 18 or older.</Text>

        {errorMessage ? <InlineNotice title="Orientation incomplete" message={errorMessage} tone="error" /> : null}

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

        <Text style={styles.betaNote}>AI feedback is practice guidance and can be wrong. Use fictional examples and avoid real patient or other sensitive personal information. Supporting excerpts from your answers remain with your feedback.</Text>
        <LegalFooter />
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged }} accessibilityLabel="I am 18 or older and have read the beta Terms and Privacy Notice" onPress={() => setAcknowledged(value => !value)} style={styles.acknowledgement}>
          <Text style={styles.check}>{acknowledged ? '☑' : '☐'}</Text>
          <Text style={styles.acknowledgementText}>I am 18 or older and have read the beta Terms and Privacy Notice.</Text>
        </TouchableOpacity>
        <Button label="Enter the circuit" onPress={handleContinue} loading={loading} style={{ marginTop: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  container: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 48 },
  station: { ...text.labelMd, color: colors.teal[600], marginBottom: 12 },
  title: { ...text.displayLg, color: colors.primary[800], marginBottom: 8 },
  sub: { ...text.bodyLg, color: colors.neutral[600], marginBottom: 28, maxWidth: 620 },
  sectionLabel: { ...text.labelMd, color: colors.neutral[500], marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  yearRow: { flexDirection: 'row', gap: 8 },
  betaNote: { ...text.bodyMd, color: colors.neutral[700], lineHeight: 24, marginTop: 12 },
  acknowledgement: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, marginTop: 16 },
  acknowledgementText: { ...text.bodyMd, color: colors.neutral[700], flex: 1 },
  check: { ...text.headingLg, color: colors.teal[600] },
  chip: {
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 2, borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white,
  },
  chipActive: { backgroundColor: colors.teal[400], borderColor: colors.teal[400] },
  chipText: { ...text.bodyMd, color: colors.neutral[700] },
  chipTextActive: { color: colors.primary[900], fontFamily: 'SourceSans3_600SemiBold' },
  yearChip: {
    flex: 1, paddingVertical: 10, borderRadius: 2,
    borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white, alignItems: 'center',
  },
});
