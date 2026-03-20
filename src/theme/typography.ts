import { StyleSheet } from 'react-native';

export const fonts = {
  display: 'DMSerifDisplay_400Regular',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodyBold: 'DMSans_700Bold',
};

export const text = StyleSheet.create({
  displayXl: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 30, lineHeight: 38 },
  displayLg: { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 24, lineHeight: 32 },
  headingLg: { fontFamily: 'DMSans_700Bold', fontSize: 22, lineHeight: 28 },
  headingMd: { fontFamily: 'DMSans_700Bold', fontSize: 18, lineHeight: 24 },
  headingSm: { fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 20 },
  bodyLg: { fontFamily: 'DMSans_400Regular', fontSize: 17, lineHeight: 26 },
  bodyMd: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22 },
  bodySm: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18 },
  labelMd: { fontFamily: 'DMSans_500Medium', fontSize: 11, lineHeight: 16, letterSpacing: 1.4 },
  caption: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 16 },
});
