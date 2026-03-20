import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { getRandomQuestion } from '../../src/lib/questions';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { colors, text } from '../../src/theme';
import type { QuestionCategory } from '../../src/types';

const MODES = [
  { id: 'practice', icon: '💬', title: 'Free Practice', desc: 'No timer, take your time', timed: false },
  { id: 'timed', icon: '⏱', title: 'Timed Practice', desc: '8 min per question', timed: true },
  { id: 'mmi', icon: '🔄', title: 'MMI Circuit', desc: '6 stations, timed', timed: true },
];

const CATEGORIES: { key: QuestionCategory; icon: string; name: string }[] = [
  { key: 'ethics', icon: '⚖️', name: 'Ethics' },
  { key: 'motivation', icon: '💡', name: 'Motivation' },
  { key: 'nhs', icon: '🏥', name: 'NHS' },
  { key: 'teamwork', icon: '🤝', name: 'Teamwork' },
  { key: 'resilience', icon: '💪', name: 'Resilience' },
  { key: 'scenarios', icon: '🎭', name: 'Scenarios' },
];

export default function PracticeScreen() {
  const [selectedMode, setSelectedMode] = useState('practice');
  const [selectedCategory, setSelectedCategory] = useState<QuestionCategory | null>(null);
  const [loading, setLoading] = useState(false);
  const profile = useAuthStore(s => s.profile);
  const { startSession, setCurrentQuestion } = usePracticeStore();

  const handleStart = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const question = await getRandomQuestion(selectedCategory ?? undefined);
      if (!question) {
        Alert.alert(
          'No questions yet',
          'The question bank is being built. Check back soon, or ask an admin to upload questions.',
        );
        return;
      }

      if (selectedMode === 'mmi') {
        router.push('/practice/mmi-lobby');
        return;
      }

      setCurrentQuestion(question);
      const sessionId = await startSession(profile.id, question);
      router.push({ pathname: '/practice/session', params: { sessionId, questionId: question.id, timed: selectedMode === 'timed' ? '1' : '0' } });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <Text style={styles.title}>Practice</Text>
      <Text style={styles.sub}>Choose your mode and category, then start.</Text>

      <SectionHeader title="Mode" />
      {MODES.map(mode => (
        <TouchableOpacity
          key={mode.id}
          style={[styles.modeCard, selectedMode === mode.id && styles.modeCardActive]}
          onPress={() => setSelectedMode(mode.id)}
          activeOpacity={0.75}
        >
          <Text style={styles.modeIcon}>{mode.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeName, selectedMode === mode.id && styles.modeNameActive]}>{mode.title}</Text>
            <Text style={styles.modeDesc}>{mode.desc}</Text>
          </View>
          {selectedMode === mode.id && <Text style={styles.check}>✓</Text>}
        </TouchableOpacity>
      ))}

      <SectionHeader title="Category" />
      <View style={styles.catGrid}>
        <TouchableOpacity
          style={[styles.catChip, !selectedCategory && styles.catChipActive]}
          onPress={() => setSelectedCategory(null)}
        >
          <Text style={[styles.catChipText, !selectedCategory && styles.catChipTextActive]}>All</Text>
        </TouchableOpacity>
        {CATEGORIES.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[styles.catChip, selectedCategory === c.key && styles.catChipActive]}
            onPress={() => setSelectedCategory(c.key)}
          >
            <Text style={styles.catEmoji}>{c.icon}</Text>
            <Text style={[styles.catChipText, selectedCategory === c.key && styles.catChipTextActive]}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Button
        label="Start Session →"
        onPress={handleStart}
        loading={loading}
        style={{ marginTop: 32 }}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 28, color: colors.primary[800] },
  sub: { ...text.bodyMd, color: colors.neutral[500], marginTop: 4, marginBottom: 4 },
  modeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.white, borderRadius: 12,
    padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.bg.tertiary,
  },
  modeCardActive: { borderColor: colors.teal[400], backgroundColor: colors.teal[100] },
  modeIcon: { fontSize: 24, width: 40 },
  modeName: { ...text.headingSm, color: colors.primary[800] },
  modeNameActive: { color: colors.teal[600] },
  modeDesc: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
  check: { color: colors.teal[400], fontSize: 20, fontFamily: 'DMSans_700Bold' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 99, borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white,
  },
  catChipActive: { backgroundColor: colors.teal[400], borderColor: colors.teal[400] },
  catEmoji: { fontSize: 14 },
  catChipText: { ...text.bodySm, color: colors.neutral[700] },
  catChipTextActive: { color: '#fff', fontFamily: 'DMSans_500Medium' },
});
