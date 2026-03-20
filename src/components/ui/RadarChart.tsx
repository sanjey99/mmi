/**
 * RadarChart — 5-axis pentagon chart for AI feedback.
 * Built with react-native-svg — works on iOS and Android.
 * Axes: Structure, Ethics, Communication, Reflection, NHS Awareness
 */
import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import Svg, { Polygon, Line, Text as SvgText, G } from 'react-native-svg';
import { colors } from '../../theme';

interface RadarChartProps {
  scores: {
    structure: number;
    ethics: number;
    communication: number;
    reflection: number;
    nhs_awareness: number;
  };
  size?: number;
}

const DIMENSIONS = ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'] as const;
const LABELS = ['Structure', 'Ethics', 'Communication', 'Reflection', 'NHS'];

function polarToXY(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

export function RadarChart({ scores, size = 220 }: RadarChartProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
      delay: 300,
    }).start();
  }, []);

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.35;
  const minR = size * 0.07; // score=1 maps here

  // Pentagon angles: start from top (−π/2), go clockwise
  const angles = DIMENSIONS.map((_, i) => (i / 5) * 2 * Math.PI - Math.PI / 2);

  // Score polygon points
  const scorePoints = DIMENSIONS.map((dim, i) => {
    const r = minR + ((scores[dim] - 1) / 4) * (maxR - minR);
    return polarToXY(cx, cy, r, angles[i]);
  }).map(p => `${p.x},${p.y}`).join(' ');

  // Background grid pentagons (at 25%, 50%, 75%, 100%)
  const gridPolygons = [0.25, 0.5, 0.75, 1.0].map(pct => {
    const r = minR + pct * (maxR - minR);
    return angles.map(a => polarToXY(cx, cy, r, a)).map(p => `${p.x},${p.y}`).join(' ');
  });

  // Label positions (slightly beyond maxR)
  const labelR = maxR + 18;
  const labelPositions = LABELS.map((label, i) => {
    const { x, y } = polarToXY(cx, cy, labelR, angles[i]);
    return { label, x, y };
  });

  const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }], width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* Grid polygons */}
          {gridPolygons.map((pts, i) => (
            <Polygon
              key={i}
              points={pts}
              fill="none"
              stroke={colors.primary[200]}
              strokeWidth={0.8}
              opacity={0.5}
            />
          ))}

          {/* Axis lines */}
          {angles.map((a, i) => {
            const end = polarToXY(cx, cy, maxR, a);
            return (
              <Line
                key={i}
                x1={cx} y1={cy}
                x2={end.x} y2={end.y}
                stroke={colors.primary[200]}
                strokeWidth={0.8}
                opacity={0.4}
              />
            );
          })}

          {/* Score polygon */}
          <Polygon
            points={scorePoints}
            fill={`${colors.teal[400]}40`}
            stroke={colors.teal[400]}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />

          {/* Labels */}
          {labelPositions.map(({ label, x, y }, i) => (
            <SvgText
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontFamily="DMSans_500Medium"
              fill={colors.primary[700]}
            >
              {label}
            </SvgText>
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}
