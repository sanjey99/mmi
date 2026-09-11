import { test as nodeTest } from 'node:test';
const rubricModulePath = new URL('../supabase/functions/_shared/rubricAssessment.ts', import.meta.url).href;
const { createRubricResponseSchema, parseRubricProviderAssessment, toPublicRubricAssessment } = await import(rubricModulePath);

const criteria = [
  { criterionId: 'C1', bulletText: 'First', domain: null },
  { criterionId: 'C2', bulletText: 'Second', domain: null },
  { criterionId: 'C3', bulletText: 'Third', domain: null },
  { criterionId: 'C4', bulletText: 'Fourth', domain: null },
] as const;
const decisions = [
  { criterionId: 'C1', achieved: true, evidenceReference: { start: 0, end: 4 } },
  { criterionId: 'C2', achieved: false, evidenceReference: null },
  { criterionId: 'C3', achieved: false, evidenceReference: null },
  { criterionId: 'C4', achieved: false, evidenceReference: null },
] as const;

if (process.env.VITEST) {
  const { describe, expect, it } = await import('vitest');

  describe('strict rubric assessment domain', () => {
  it('owns equal weighting and omits private evidence and transcript text', () => {
    const result = toPublicRubricAssessment(decisions, criteria, 'Safe escalation is required.');
    expect(result.questionScorePct).toBe(25);
    expect(result.criteria.map((item: { weightPct: number }) => item.weightPct)).toEqual([25, 25, 25, 25]);
    expect(JSON.stringify(result)).not.toContain('Safe escalation');
    expect(JSON.stringify(result)).not.toContain('evidenceReference');
  });

  it('uses equal 20% weights for five criteria and two-decimal rounding for thirds', () => {
    const five = Array.from({ length: 5 }, (_, index) => ({ criterionId: `C${index + 1}`, bulletText: `Criterion ${index + 1}`, domain: null }));
    const fiveDecisions = five.map((criterion, index) => ({ criterionId: criterion.criterionId, achieved: index < 3, evidenceReference: index < 3 ? { start: index, end: index + 1 } : null }));
    expect(toPublicRubricAssessment(fiveDecisions, five, 'abcde')).toMatchObject({ questionScorePct: 60, criteria: Array.from({ length: 5 }, () => ({ weightPct: 20 })) });
    expect(toPublicRubricAssessment(decisions.slice(0, 3), criteria.slice(0, 3), 'Safe escalation is required.')).toMatchObject({ questionScorePct: 33.33, criteria: Array.from({ length: 3 }, () => ({ weightPct: 33.33 })) });
  });

  it('creates an exact, bounded schema for supplied criteria', () => {
    expect(createRubricResponseSchema(criteria)).toMatchObject({
      type: 'object', additionalProperties: false, required: ['decisions'],
      properties: { decisions: { type: 'array', minItems: 4, maxItems: 4, items: { properties: { criterionId: { enum: ['C1', 'C2', 'C3', 'C4'] } } } } },
    });
  });

  it.each([
    ['missing', decisions.slice(0, 3)],
    ['extra', [...decisions, { criterionId: 'C4', achieved: false, evidenceReference: null }]],
    ['duplicate', [{ ...decisions[0] }, { ...decisions[0] }, ...decisions.slice(2)]],
    ['reordered', [decisions[1], decisions[0], ...decisions.slice(2)]],
    ['unknown ID', [{ ...decisions[0], criterionId: 'OTHER' }, ...decisions.slice(1)]],
    ['non-boolean', [{ ...decisions[0], achieved: 'true' }, ...decisions.slice(1)]],
    ['invalid positive evidence', [{ ...decisions[0], evidenceReference: { start: 4, end: 4 } }, ...decisions.slice(1)]],
    ['negative with evidence', [{ ...decisions[0] }, { ...decisions[1], evidenceReference: { start: 0, end: 1 } }, ...decisions.slice(2)]],
  ])('rejects %s decisions', (_name, invalid) => {
    expect(() => parseRubricProviderAssessment(JSON.stringify({ decisions: invalid }), criteria, 'Safe escalation is required.')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });

  it('validates evidence offsets by Unicode code point, not UTF-16 code unit', () => {
    expect(parseRubricProviderAssessment(JSON.stringify({ decisions }), criteria, 'Safe escalation is required.')).toEqual(decisions);
    expect(() => parseRubricProviderAssessment(JSON.stringify({ decisions: [{ ...decisions[0], evidenceReference: { start: 0, end: 30 } }, ...decisions.slice(1)] }), criteria, '😀abc')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });
  });
} else {
  nodeTest('rubric assessment suite is executed by Vitest', () => {});
}
