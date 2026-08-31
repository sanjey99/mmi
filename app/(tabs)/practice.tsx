import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';
import { usePracticeStore } from '../../src/stores/practiceStore';
import { getActiveQuestionCounts, getRandomQuestion } from '../../src/lib/questions';
import { supabase } from '../../src/lib/supabase';
import { isNormalizedMmiStationEnabled } from '../../src/features/candidateMmi/featureFlag';
import { Button } from '../../src/components/ui/Button';
import { InlineNotice } from '../../src/components/feedback/InlineNotice';
import { ScreenWrapper } from '../../src/components/layout/ScreenWrapper';
import { colors, text } from '../../src/theme';
import type { QuestionCategory } from '../../src/types';
import type { QuestionCounts } from '../../src/features/questions/selection';

const MODES = [
  { id: 'practice', station: 'P', title: 'Free practice', desc: 'No timer; take time to structure your response.', timed: false },
  { id: 'timed', station: '08', title: 'Timed practice', desc: 'Eight minutes from entry to submission.', timed: true },
];
const CANDIDATE_MMI_MODE = {
  id: 'candidate', station: '11', title: 'Candidate station', desc: '11-minute timed MMI station.', timed: false,
};

const CATEGORIES: { key: QuestionCategory; station: string; name: string }[] = [
  { key: 'ethics', station: 'E', name: 'Ethics' },
  { key: 'motivation', station: 'M', name: 'Motivation' },
  { key: 'nhs', station: 'N', name: 'NHS' },
  { key: 'teamwork', station: 'T', name: 'Teamwork' },
  { key: 'resilience', station: 'R', name: 'Resilience' },
  { key: 'scenarios', station: 'S', name: 'Scenarios' },
];

export default function PracticeScreen() {
  const [selectedMode, setSelectedMode] = useState('practice');
  const [selectedCategory, setSelectedCategory] = useState<QuestionCategory | null>(null);
  const [loading, setLoading] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [candidateEnabled, setCandidateEnabled] = useState(false);
  const [candidateFlagLoading, setCandidateFlagLoading] = useState(true);
  const [counts, setCounts] = useState<QuestionCounts | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const profile = useAuthStore(s => s.profile);
  const { currentQuestion, startSession, setCurrentQuestion } = usePracticeStore();

  const loadAvailability = useCallback(async () => {
    setAvailabilityLoading(true);
    setErrorMessage(null);
    try {
      setCounts(await getActiveQuestionCounts());
    } catch {
      setErrorMessage('The Question Desk could not be reached. Check your connection and try again.');
    } finally {
      setAvailabilityLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  useEffect(() => {
    let active = true;
    const readConfig = async (key: string): Promise<unknown> => {
      const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
      if (error) throw error;
      return data?.value;
    };
    void isNormalizedMmiStationEnabled(readConfig).then(enabled => {
      if (!active) return;
      setCandidateEnabled(enabled);
      setCandidateFlagLoading(false);
    });
    return () => { active = false; };
  }, []);

  const totalAvailable = useMemo(
    () => counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0,
    [counts],
  );

  const handleStart = async () => {
    if (selectedMode === 'candidate') {
      router.push('/practice/mmi-station' as never);
      return;
    }
    if (!profile) return;
    if (selectedCategory && (counts?.[selectedCategory] ?? 0) === 0) {
      setErrorMessage('That station has no active questions yet. Choose an available station.');
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      const question = await getRandomQuestion(selectedCategory ?? undefined, currentQuestion?.id);
      if (!question) {
        setErrorMessage('No active question matches this route. Ask a cofounder to add one in the Question Desk.');
        return;
      }

      setCurrentQuestion(question);
      const sessionId = await startSession(profile.id, question);
      router.push({ pathname: '/practice/session', params: { sessionId, questionId: question.id, timed: selectedMode === 'timed' ? '1' : '0' } });
    } catch {
      setErrorMessage('The station could not be opened. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <Text style={styles.routeLabel}>02 / PRACTISE</Text>
      <Text style={styles.title}>Choose a station door</Text>
      <Text style={styles.sub}>Pick the timing and one available category. Empty stations stay closed until content is added.</Text>

      {errorMessage ? (
        <View style={styles.noticeWrap}>
          <InlineNotice title="Station unavailable" message={errorMessage} tone="error" />
          <Button label="Check again" variant="secondary" small onPress={loadAvailability} style={styles.retryButton} />
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Timing</Text>
      {(candidateEnabled ? [...MODES, CANDIDATE_MMI_MODE] : MODES).map(mode => (
        <TouchableOpacity
          key={mode.id}
          style={[styles.modeCard, selectedMode === mode.id && styles.modeCardActive]}
          onPress={() => setSelectedMode(mode.id)}
          activeOpacity={0.75}
        >
          <Text style={styles.modeIcon}>{mode.station}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeName, selectedMode === mode.id && styles.modeNameActive]}>{mode.title}</Text>
            <Text style={styles.modeDesc}>{mode.desc}</Text>
          </View>
          <Text style={styles.stateText}>{selectedMode === mode.id ? 'SELECTED' : 'CHOOSE'}</Text>
        </TouchableOpacity>
      ))}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Station</Text>
        <Text style={styles.availabilityText}>
          {availabilityLoading ? 'CHECKING' : `${totalAvailable} ACTIVE`}
        </Text>
      </View>
      <View style={styles.catGrid}>
        <TouchableOpacity
          style={[styles.catChip, !selectedCategory && styles.catChipActive]}
          onPress={() => setSelectedCategory(null)}
          disabled={totalAvailable === 0}
          accessibilityState={{ selected: !selectedCategory, disabled: totalAvailable === 0 }}
        >
          <Text style={styles.catStation}>ALL</Text>
          <Text style={[styles.catChipText, !selectedCategory && styles.catChipTextActive]}>Any available station</Text>
          <Text style={styles.catCount}>{totalAvailable}</Text>
        </TouchableOpacity>
        {CATEGORIES.map(c => {
          const count = counts?.[c.key] ?? 0;
          const unavailable = count === 0;
          const selected = selectedCategory === c.key;
          return (
            <TouchableOpacity
              key={c.key}
              style={[styles.catChip, selected && styles.catChipActive, unavailable && styles.catChipDisabled]}
              onPress={() => setSelectedCategory(c.key)}
              disabled={unavailable}
              accessibilityState={{ selected, disabled: unavailable }}
            >
              <Text style={styles.catStation}>{c.station}</Text>
              <Text style={[styles.catChipText, selected && styles.catChipTextActive]}>{c.name}</Text>
              <Text style={styles.catCount}>{unavailable ? 'CLOSED' : count}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Button
        label="Enter station"
        onPress={handleStart}
        loading={loading}
        disabled={loading || (selectedMode === 'candidate'
          ? candidateFlagLoading
          : availabilityLoading || totalAvailable === 0)}
        style={{ marginTop: 32 }}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  routeLabel: { ...text.labelMd, color: colors.teal[600], marginBottom: 8 },
  title: { ...text.displayLg, color: colors.primary[900] },
  sub: { ...text.bodyLg, color: colors.neutral[600], marginTop: 6, marginBottom: 20, maxWidth: 680 },
  noticeWrap: { gap: 10, marginBottom: 18 },
  retryButton: { alignSelf: 'flex-start' },
  sectionTitle: { ...text.headingMd, color: colors.primary[900], marginTop: 20, marginBottom: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  availabilityText: { ...text.labelMd, color: colors.neutral[600], marginBottom: 10 },
  modeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.white, borderRadius: 2,
    padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.bg.tertiary,
  },
  modeCardActive: { borderColor: colors.teal[400], backgroundColor: colors.teal[100] },
  modeIcon: { ...text.headingLg, color: colors.primary[900], width: 44, fontVariant: ['tabular-nums'] },
  modeName: { ...text.headingSm, color: colors.primary[800] },
  modeNameActive: { color: colors.teal[600] },
  modeDesc: { ...text.caption, color: colors.neutral[500], marginTop: 2 },
  stateText: { ...text.labelMd, color: colors.neutral[600] },
  catGrid: { gap: 8 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    minHeight: 48, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 2, borderWidth: 1.5, borderColor: colors.bg.tertiary,
    backgroundColor: colors.bg.white,
  },
  catChipActive: { backgroundColor: colors.teal[400], borderColor: colors.teal[400] },
  catChipDisabled: { backgroundColor: colors.bg.secondary, opacity: 0.68 },
  catStation: { ...text.labelMd, color: colors.primary[900], width: 52 },
  catChipText: { ...text.bodyMd, color: colors.neutral[700], flex: 1 },
  catChipTextActive: { color: colors.primary[900], fontFamily: 'SourceSans3_600SemiBold' },
  catCount: { ...text.labelMd, color: colors.primary[900], minWidth: 54, textAlign: 'right' },
});
