import { corridorColors } from './designTokens';

export const colors = {
  primary: {
    900: '#17181A',
    800: corridorColors.enamel,
    700: corridorColors.enamelRaised,
    600: '#45494D',
    500: corridorColors.inkMuted,
    400: '#74787B',
    300: '#9A9D9F',
    200: corridorColors.line,
    100: corridorColors.wallMuted,
  },
  // Compatibility alias while legacy screens move to semantic corridor tokens.
  teal: {
    600: corridorColors.routeDark,
    500: '#C99D13',
    400: corridorColors.route,
    300: '#F7D76E',
    200: '#FAE8A7',
    100: '#FFF6D6',
  },
  bg: {
    primary: corridorColors.wall,
    secondary: corridorColors.wallMuted,
    tertiary: corridorColors.line,
    white: corridorColors.paper,
  },
  success: corridorColors.success,
  warning: corridorColors.routeDark,
  error: corridorColors.direction,
  info: corridorColors.info,
  score: {
    structure: corridorColors.enamel,
    ethics: corridorColors.routeDark,
    communication: corridorColors.info,
    reflection: '#6F536E',
    nhs: corridorColors.direction,
  },
  neutral: {
    900: corridorColors.enamel,
    700: '#414448',
    600: corridorColors.inkMuted,
    500: '#6C7073',
    400: '#85898C',
    300: '#AEB1B2',
    100: corridorColors.wallMuted,
  },
} as const;
