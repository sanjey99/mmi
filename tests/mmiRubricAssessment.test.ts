import { test as nodeTest } from 'node:test';
const rubricModulePath = new URL('../supabase/functions/_shared/rubricAssessment.ts', import.meta.url).href;
const {
  createRubricResponseSchema,
  createRubricQuoteResponseSchema,
  MAX_RUBRIC_EVIDENCE_QUOTE_CODE_POINTS,
  parseRubricProviderAssessment,
  parseRubricQuoteProviderAssessment,
  toPublicRubricAssessment,
} = await import(rubricModulePath);

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
const quoteDecisions = [
  { criterionId: 'C1', achieved: true, evidenceQuote: 'Safe escalation' },
  { criterionId: 'C2', achieved: false, evidenceQuote: null },
  { criterionId: 'C3', achieved: false, evidenceQuote: null },
  { criterionId: 'C4', achieved: false, evidenceQuote: null },
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

  it('requests bounded exact quotes while retaining the internal offset schema', () => {
    expect(createRubricQuoteResponseSchema(criteria)).toMatchObject({
      type: 'object', additionalProperties: false, required: ['decisions'],
      properties: { decisions: {
        minItems: 4, maxItems: 4,
        items: {
          additionalProperties: false,
          required: ['criterionId', 'achieved', 'evidenceQuote'],
          properties: {
            criterionId: { enum: ['C1', 'C2', 'C3', 'C4'] },
            evidenceQuote: { anyOf: [{ type: 'string', minLength: 1, maxLength: MAX_RUBRIC_EVIDENCE_QUOTE_CODE_POINTS }, { type: 'null' }] },
          },
        },
      } },
    });
    expect(JSON.stringify(createRubricQuoteResponseSchema(criteria))).not.toContain('evidenceReference');
    expect(JSON.stringify(createRubricResponseSchema(criteria))).not.toContain('evidenceQuote');
  });

  it('derives exact code-point offsets from quotes after emoji in a long answer', () => {
    const prefix = '😀 I would listen first. '.repeat(150);
    const transcript = `${prefix}Safe escalation is required. 😀`;
    const start = Array.from(prefix).length;
    const parsed = parseRubricQuoteProviderAssessment(JSON.stringify({ decisions: quoteDecisions }), criteria, transcript);
    expect(parsed).toEqual([
      { criterionId: 'C1', achieved: true, evidenceReference: { start, end: start + 15 } },
      ...decisions.slice(1),
    ]);
    const publicAssessment = toPublicRubricAssessment(parsed, criteria, transcript);
    expect(publicAssessment).toMatchObject({ schemaVersion: 3, questionScorePct: 25 });
    expect(JSON.stringify(publicAssessment)).not.toContain('evidence');
    expect(JSON.stringify(publicAssessment)).not.toContain('Safe escalation');
  });

  it('accepts quotes containing whole Unicode code points and deterministically resolves repeated quotes', () => {
    const unicodeDecisions = [{ ...quoteDecisions[0], evidenceQuote: '😀 café' }, ...quoteDecisions.slice(1)];
    expect(parseRubricQuoteProviderAssessment(JSON.stringify({ decisions: unicodeDecisions }), criteria, 'x 😀 café; 😀 café')).toEqual([
      { criterionId: 'C1', achieved: true, evidenceReference: { start: 2, end: 8 } },
      ...decisions.slice(1),
    ]);
  });

  it.each([
    ['missing', quoteDecisions.slice(0, 3)],
    ['extra', [...quoteDecisions, quoteDecisions[3]]],
    ['duplicate', [quoteDecisions[0], quoteDecisions[0], ...quoteDecisions.slice(2)]],
    ['reordered', [quoteDecisions[1], quoteDecisions[0], ...quoteDecisions.slice(2)]],
    ['unknown criterion', [{ ...quoteDecisions[0], criterionId: 'OTHER' }, ...quoteDecisions.slice(1)]],
    ['non-boolean', [{ ...quoteDecisions[0], achieved: 'true' }, ...quoteDecisions.slice(1)]],
    ['missing evidence', [{ ...quoteDecisions[0], evidenceQuote: null }, ...quoteDecisions.slice(1)]],
    ['empty evidence', [{ ...quoteDecisions[0], evidenceQuote: '' }, ...quoteDecisions.slice(1)]],
    ['blank evidence', [{ ...quoteDecisions[0], evidenceQuote: ' ' }, ...quoteDecisions.slice(1)]],
    ['fabricated evidence', [{ ...quoteDecisions[0], evidenceQuote: 'I documented every action.' }, ...quoteDecisions.slice(1)]],
    ['paraphrased evidence', [{ ...quoteDecisions[0], evidenceQuote: 'safe escalation' }, ...quoteDecisions.slice(1)]],
    ['negative evidence', [quoteDecisions[0], { ...quoteDecisions[1], evidenceQuote: 'Safe' }, ...quoteDecisions.slice(2)]],
    ['extra offset fields', [{ ...quoteDecisions[0], evidenceReference: { start: 0, end: 1 } }, ...quoteDecisions.slice(1)]],
    ['model-created offsets', decisions],
  ])('rejects %s in provider quote decisions', (_name, invalid) => {
    expect(() => parseRubricQuoteProviderAssessment(JSON.stringify({ decisions: invalid }), criteria, 'Safe escalation is required.')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });

  it('rejects oversized exact quotes and partial emoji surrogates without awarding fallback credit', () => {
    const oversizedQuote = 'a'.repeat(MAX_RUBRIC_EVIDENCE_QUOTE_CODE_POINTS + 1);
    expect(() => parseRubricQuoteProviderAssessment(JSON.stringify({ decisions: [{ ...quoteDecisions[0], evidenceQuote: oversizedQuote }, ...quoteDecisions.slice(1)] }), criteria, oversizedQuote)).toThrow('AI_PROVIDER_RESPONSE_INVALID');
    expect(() => parseRubricQuoteProviderAssessment(JSON.stringify({ decisions: [{ ...quoteDecisions[0], evidenceQuote: '\ude00' }, ...quoteDecisions.slice(1)] }), criteria, '😀')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
    expect(() => parseRubricQuoteProviderAssessment('{"decisions":[', criteria, 'Safe escalation')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
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
    const unicodeDecisions = [{ ...decisions[0], evidenceReference: { start: 0, end: 4 } }, ...decisions.slice(1)];
    expect(parseRubricProviderAssessment(JSON.stringify({ decisions: unicodeDecisions }), criteria, '😀abc')).toEqual(unicodeDecisions);
    expect(() => parseRubricProviderAssessment(JSON.stringify({ decisions: [{ ...decisions[0], evidenceReference: { start: 0, end: 5 } }, ...decisions.slice(1)] }), criteria, '😀abc')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });
  });
} else {
  nodeTest('rubric assessment suite is executed by Vitest', () => {});
}
