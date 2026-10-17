import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CandidateMmiCriterionResult } from '../../features/candidateMmi/api';
import { criterionMarks, criterionPerformanceLevel, formatRubricMark, MMI_PERFORMANCE_LABELS } from '../../features/mmi/rubricPerformance';
import { colors, corridorTypography } from '../../theme';

type RubricChecklistProps = Readonly<{
  criteria: readonly CandidateMmiCriterionResult[];
}>;

export function RubricChecklist({ criteria }: RubricChecklistProps) {
  return (
    <View style={styles.list}>
      {criteria.map((criterion) => {
        const level = criterionPerformanceLevel(criterion);
        const graduated = 'performanceLevel' in criterion;
        const marks = `${formatRubricMark(criterionMarks(criterion))}/${formatRubricMark(criterion.weightPct)}`;
        return (
        <View
          key={criterion.criterionId}
          accessibilityRole={graduated ? undefined : 'checkbox'}
          accessibilityState={graduated ? undefined : { checked: level === 4 }}
          style={styles.row}
        >
          {!graduated ? <Text style={[styles.box, level === 4 ? styles.checked : styles.unchecked]}>
            {level === 4 ? '✓' : '□'}
          </Text> : null}
          <View style={styles.copy}>
            <Text style={styles.bullet}>{criterion.bulletText}{graduated ? `: ${marks}` : ''}</Text>
            <Text style={styles.meta}>
              {criterion.domain ? `${criterion.domain} · ` : ''}{graduated ? `${MMI_PERFORMANCE_LABELS[level]} · ${level * 25}% of criterion marks` : `${formatRubricMark(criterion.weightPct)}%`}
            </Text>
            {graduated ? <>
              {criterion.evidenceQuote !== null ? <Text style={styles.evidence}>From your answer: “{criterion.evidenceQuote}”</Text> : <Text style={styles.meta}>No supporting evidence identified in your answer.</Text>}
              <Text style={styles.justification}>{criterion.justification}</Text>
            </> : null}
          </View>
        </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  box: { fontFamily: corridorTypography.readingMedium, fontSize: 22, lineHeight: 28 },
  checked: { color: colors.success },
  unchecked: { color: colors.neutral[500] },
  copy: { flex: 1, gap: 2 },
  bullet: { fontFamily: corridorTypography.reading, fontSize: 18, lineHeight: 27, color: colors.neutral[700] },
  meta: { fontFamily: corridorTypography.reading, fontSize: 15, lineHeight: 21, color: colors.neutral[600] },
  evidence: { fontFamily: corridorTypography.reading, fontSize: 16, lineHeight: 24, color: colors.neutral[700], marginTop: 6, fontStyle: 'italic' },
  justification: { fontFamily: corridorTypography.reading, fontSize: 16, lineHeight: 24, color: colors.neutral[700], marginTop: 4 },
});
