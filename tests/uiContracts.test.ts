import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('released surface visual contract', () => {
  const releasedSurfaces = [
    'app/(tabs)/index.tsx',
    'app/(tabs)/progress.tsx',
    'app/(tabs)/questions.tsx',
    'app/(tabs)/tutor.tsx',
    'app/admin/index.tsx',
    'app/admin/ai-config.tsx',
    'app/practice/feedback.tsx',
    'src/components/ui/Input.tsx',
    'src/components/ui/RadarChart.tsx',
    'src/components/ui/ScoreDimensionBar.tsx',
    'src/components/ui/TimerRing.tsx',
  ];

  it.each(releasedSurfaces)('%s uses the independent corridor visual language', file => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');

    expect(source).not.toMatch(/DMSerifDisplay|DMSans_/);
    expect(source).not.toMatch(/Alert\.alert\(/);
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('does not present invented category progress on the orientation screen', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(tabs)/index.tsx'), 'utf8');

    expect(source).not.toContain('pct:');
    expect(source).not.toContain('dummyScores');
  });
});
