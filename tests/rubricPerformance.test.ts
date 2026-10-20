import { describe, expect, it } from 'vitest';
import { criterionMarks, criterionPerformanceLevel, formatRubricMark, MMI_PERFORMANCE_LABELS, type MmiPerformanceLevel } from '../src/features/mmi/rubricPerformance';

describe('five-level rubric presentation', () => {
  it('uses the requested five performance levels with proportional weighted marks', () => {
    expect(MMI_PERFORMANCE_LABELS).toEqual([
      'Not demonstrated', 'Mentioned only', 'Basic demonstration',
      'Good demonstration', 'Excellent demonstration',
    ]);
    const marks = ([0, 1, 2, 3, 4] as MmiPerformanceLevel[])
      .map((performanceLevel) => criterionMarks({ performanceLevel, weightPct: 25 }));
    expect(marks).toEqual([0, 6.25, 12.5, 18.75, 25]);
    expect(`${formatRubricMark(marks[2])}/${formatRubricMark(25)}`).toBe('12.5/25');
  });

  it('preserves binary historical credit and rounds only for display', () => {
    expect(criterionPerformanceLevel({ achieved: true })).toBe(4);
    expect(criterionPerformanceLevel({ achieved: false })).toBe(0);
    expect(criterionMarks({ achieved: true, weightPct: 33.33333333 })).toBe(33.33333333);
    expect(criterionMarks({ performanceLevel: 1, weightPct: 33.33333333 })).toBe(8.3333333325);
    expect(formatRubricMark(8.3333333325)).toBe('8.33');
  });
});
