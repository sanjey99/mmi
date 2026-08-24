export const spacing = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20,
  6: 24, 7: 28, 8: 32, 10: 40, 12: 48,
} as const;

export const layout = {
  screenPaddingH: 24,
  screenPaddingTop: 20,
  cardPadding: 20,
  sectionGap: 32,
  itemGap: 12,
  tabBarHeight: 72,
  headerHeight: 56,
  cardRadius: 2,
  buttonRadius: 4,
  inputRadius: 2,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#25272A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
  },
  md: {
    shadowColor: '#25272A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },
} as const;
