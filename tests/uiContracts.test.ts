import { describe, expect, it } from 'vitest';
import {
  corridorColors,
  corridorGeometry,
  corridorTypography,
} from '../src/theme/designTokens';
import { previewTabs } from '../src/navigation/tabConfig';

describe('Numbered Station Corridor design contract', () => {
  it('uses the approved independent palette without the previous teal/navy/cream brand colors', () => {
    expect(corridorColors).toMatchObject({
      wall: '#F7F8F6',
      enamel: '#25272A',
      route: '#F4C542',
      direction: '#B3342B',
    });

    expect(Object.values(corridorColors)).not.toContain('#00B4A6');
    expect(Object.values(corridorColors)).not.toContain('#0F1E3D');
    expect(Object.values(corridorColors)).not.toContain('#F7F3EE');
  });

  it('keeps posted-sheet geometry square and type tied to sourced wayfinding/readability families', () => {
    expect(corridorGeometry).toEqual({
      controlRadius: 4,
      plateRadius: 2,
      sheetRadius: 0,
      routeWidth: 8,
    });
    expect(corridorTypography).toMatchObject({
      wayfinding: 'BarlowCondensed_600SemiBold',
      wayfindingBold: 'BarlowCondensed_700Bold',
      reading: 'SourceSans3_400Regular',
      readingMedium: 'SourceSans3_600SemiBold',
    });
  });
});

describe('closed-preview tab contract', () => {
  it('shows only truthful destinations and uses text labels rather than emoji', () => {
    expect(previewTabs).toEqual([
      { route: 'index', label: 'Orient', station: '01' },
      { route: 'practice', label: 'Practise', station: '02' },
      { route: 'progress', label: 'Review', station: '03' },
    ]);
    expect(previewTabs.every(tab => /^[\x20-\x7E]+$/.test(`${tab.station}${tab.label}`))).toBe(true);
  });
});
