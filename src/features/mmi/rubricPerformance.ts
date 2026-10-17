export type MmiPerformanceLevel = 0 | 1 | 2 | 3 | 4;

export const MMI_PERFORMANCE_LABELS = Object.freeze([
  'Not demonstrated',
  'Mentioned only',
  'Basic demonstration',
  'Good demonstration',
  'Excellent demonstration',
] as const);

type CriterionPerformance = Readonly<{ performanceLevel: MmiPerformanceLevel }> | Readonly<{ achieved: boolean }>;

export function criterionPerformanceLevel(criterion: CriterionPerformance): MmiPerformanceLevel {
  return 'performanceLevel' in criterion ? criterion.performanceLevel : criterion.achieved ? 4 : 0;
}

export function criterionMarks(criterion: CriterionPerformance & Readonly<{ weightPct: number }>): number {
  return criterion.weightPct * criterionPerformanceLevel(criterion) / 4;
}

export function formatRubricMark(mark: number): string {
  return String(Math.round(mark * 100) / 100);
}
