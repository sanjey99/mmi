import { StyleSheet } from 'react-native';
import { corridorTypography } from './designTokens';

export const fonts = {
  display: corridorTypography.wayfindingBold,
  body: corridorTypography.reading,
  bodyMedium: corridorTypography.readingMedium,
  bodyBold: corridorTypography.readingMedium,
};

export const text = StyleSheet.create({
  displayXl: { fontFamily: corridorTypography.wayfindingBold, fontSize: 42, lineHeight: 44, letterSpacing: -0.6 },
  displayLg: { fontFamily: corridorTypography.wayfindingBold, fontSize: 32, lineHeight: 36, letterSpacing: -0.3 },
  headingLg: { fontFamily: corridorTypography.wayfindingBold, fontSize: 26, lineHeight: 30, letterSpacing: 0.2 },
  headingMd: { fontFamily: corridorTypography.wayfinding, fontSize: 21, lineHeight: 25, letterSpacing: 0.3 },
  headingSm: { fontFamily: corridorTypography.wayfinding, fontSize: 17, lineHeight: 21, letterSpacing: 0.4 },
  bodyLg: { fontFamily: corridorTypography.reading, fontSize: 18, lineHeight: 28 },
  bodyMd: { fontFamily: corridorTypography.reading, fontSize: 16, lineHeight: 24 },
  bodySm: { fontFamily: corridorTypography.reading, fontSize: 14, lineHeight: 20 },
  labelMd: { fontFamily: corridorTypography.wayfinding, fontSize: 13, lineHeight: 16, letterSpacing: 1.2 },
  caption: { fontFamily: corridorTypography.reading, fontSize: 13, lineHeight: 18 },
});
