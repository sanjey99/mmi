export const spacing = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20,
  6: 24, 7: 28, 8: 32, 10: 40, 12: 48,
} as const;

export const layout = {
  screenPaddingH: 20,
  screenPaddingTop: 16,
  cardPadding: 16,
  sectionGap: 24,
  itemGap: 12,
  tabBarHeight: 64,
  headerHeight: 56,
  cardRadius: 12,
  buttonRadius: 16,
  inputRadius: 12,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#0F1E3D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#0F1E3D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;
