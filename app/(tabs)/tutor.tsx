import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { colors, text, shadows } from '../../src/theme';

const TUTORS = [
  { initials: 'SC', name: 'Dr. Sarah Chen', uni: 'Oxford Graduate', exp: '5 years', rating: 4.9, reviews: 48, pricePence: 5500, spec: 'MMI, Ethics stations', color: colors.teal[400] },
  { initials: 'JO', name: 'James Okonkwo', uni: 'Imperial Graduate', exp: '3 years', rating: 4.7, reviews: 22, pricePence: 4000, spec: 'Motivation, NHS questions', color: colors.primary[500] },
  { initials: 'PM', name: 'Priya Mehta', uni: "King's Graduate", exp: '4 years', rating: 4.8, reviews: 35, pricePence: 4500, spec: 'Panel interviews, scenarios', color: colors.score.reflection },
];

export default function TutorScreen() {
  const handleBook = (name: string) => {
    Alert.alert('Booking coming soon', `Tutor booking with ${name} will be available in Phase 6.`);
  };

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Book a Tutor</Text>
      <Text style={styles.sub}>1-to-1 mock interview sessions with verified medical graduates.</Text>

      <View style={styles.filterRow}>
        {['All', 'Oxford', 'Imperial', 'UCL', 'King\'s'].map(f => (
          <TouchableOpacity key={f} style={[styles.chip, f === 'All' && styles.chipActive]}>
            <Text style={[styles.chipText, f === 'All' && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {TUTORS.map(t => (
        <Card key={t.name} style={styles.card} elevated>
          <View style={styles.tutorHeader}>
            <View style={[styles.avatar, { backgroundColor: t.color }]}>
              <Text style={styles.avatarText}>{t.initials}</Text>
              <View style={styles.verifiedBadge}>
                <Text style={{ color: '#fff', fontSize: 9 }}>✓</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tutorName}>{t.name}</Text>
              <Text style={styles.tutorSpec}>{t.uni} · {t.exp} exp</Text>
              <Text style={styles.tutorRating}>⭐ {t.rating} · {t.reviews} reviews</Text>
              <Text style={styles.tutorPrice}>£{(t.pricePence / 100).toFixed(0)} / 60 min</Text>
            </View>
          </View>
          <Text style={styles.tutorDesc}>{t.spec}</Text>
          <Button label="Book Session" onPress={() => handleBook(t.name)} style={{ height: 44, marginTop: 12 }} />
        </Card>
      ))}

      <Card variant="teal" style={{ marginTop: 8 }}>
        <Text style={styles.comingTitle}>💡 Tutor marketplace in Phase 6</Text>
        <Text style={styles.comingText}>Full calendar booking, Stripe payments (£30–60/session), ratings and reviews launching late June 2026.</Text>
      </Card>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: colors.primary[800] },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginTop: 4, marginBottom: 16 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1.5, borderColor: colors.bg.tertiary, backgroundColor: colors.bg.white },
  chipActive: { backgroundColor: colors.teal[400], borderColor: colors.teal[400] },
  chipText: { ...text.bodySm, color: colors.neutral[700] },
  chipTextActive: { color: '#fff', fontFamily: 'DMSans_500Medium' },
  card: { marginBottom: 14 },
  tutorHeader: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarText: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 18 },
  verifiedBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.teal[400], alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  tutorName: { ...text.headingSm, color: colors.primary[800] },
  tutorSpec: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
  tutorRating: { ...text.caption, color: colors.neutral[700], marginTop: 2 },
  tutorPrice: { ...text.headingSm, color: colors.teal[500], marginTop: 4 },
  tutorDesc: { ...text.bodySm, color: colors.neutral[700] },
  comingTitle: { ...text.headingSm, color: colors.teal[600], marginBottom: 6 },
  comingText: { ...text.bodyMd, color: colors.primary[800] },
});
