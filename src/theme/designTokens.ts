export const corridorColors = Object.freeze({
  wall: '#F7F8F6',
  wallMuted: '#E8E9E5',
  paper: '#FFFFFF',
  enamel: '#25272A',
  enamelRaised: '#34373B',
  route: '#F4C542',
  routeDark: '#8A6900',
  direction: '#B3342B',
  directionDark: '#7B211C',
  success: '#276447',
  info: '#315A79',
  inkMuted: '#5B5F63',
  line: '#C9CBC7',
} as const);

export const corridorGeometry = Object.freeze({
  controlRadius: 4,
  plateRadius: 2,
  sheetRadius: 0,
  routeWidth: 8,
} as const);

export const corridorTypography = Object.freeze({
  wayfinding: 'BarlowCondensed_600SemiBold',
  wayfindingBold: 'BarlowCondensed_700Bold',
  reading: 'SourceSans3_400Regular',
  readingMedium: 'SourceSans3_600SemiBold',
} as const);
