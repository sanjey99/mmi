import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CandidateMmiCriterionResult } from '../../features/candidateMmi/api';
import { colors, corridorTypography } from '../../theme';

type RubricChecklistProps = Readonly<{
  criteria: readonly CandidateMmiCriterionResult[];
}>;

export function RubricChecklist({ criteria }: RubricChecklistProps) {
  return (
    <View style={styles.list}>
      {criteria.map((criterion) => (
        <View
          key={criterion.criterionId}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: criterion.achieved }}
          style={styles.row}
        >
          <Text style={[styles.box, criterion.achieved ? styles.checked : styles.unchecked]}>
            {criterion.achieved ? '✓' : '□'}
          </Text>
          <View style={styles.copy}>
            <Text style={styles.bullet}>{criterion.bulletText}</Text>
            <Text style={styles.meta}>
              {criterion.domain ? `${criterion.domain} · ` : ''}{criterion.weightPct}%
            </Text>
          </View>
        </View>
      ))}
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
});
