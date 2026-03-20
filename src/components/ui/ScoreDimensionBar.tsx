import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { colors, text } from '../../theme';

interface ScoreDimensionBarProps {
  label: string;
  score: number;  // 1–5
  color: string;
  delay?: number;
}

export function ScoreDimensionBar({ label, score, color, delay = 0 }: ScoreDimensionBarProps) {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: (score / 5) * 100,
      duration: 600,
      delay,
      useNativeDriver: false,
    }).start();
  }, [score]);

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: color, width: widthAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
      <Text style={[styles.score, { color }]}>{score}/5</Text>
    </View>
  );
}

export const SCORE_COLORS = {
  structure: colors.score.structure,
  ethics: colors.score.ethics,
  communication: colors.score.communication,
  reflection: colors.score.reflection,
  nhs_awareness: colors.score.nhs,
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  label: {
    ...text.bodySm,
    color: colors.primary[800],
    width: 110,
    fontFamily: 'DMSans_500Medium',
  },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: colors.neutral[100],
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 99,
  },
  score: {
    ...text.bodySm,
    fontFamily: 'DMSans_700Bold',
    width: 28,
    textAlign: 'right',
  },
});
