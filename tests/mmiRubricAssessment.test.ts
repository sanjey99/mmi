import { test as nodeTest } from 'node:test';
const rubricModulePath = new URL('../supabase/functions/_shared/rubricAssessment.ts', import.meta.url).href;
const {
  createRubricResponseSchema,
  createRubricQuoteResponseSchema,
  createRubricEvidenceExcerpts,
  createRubricExcerptResponseSchema,
  MAX_RUBRIC_EVIDENCE_EXCERPT_CODE_POINTS,
  MAX_RUBRIC_EVIDENCE_QUOTE_CODE_POINTS,
  parseRubricProviderAssessment,
  parseRubricQuoteProviderAssessment,
  parseRubricExcerptProviderAssessment,
  RubricAssessmentValidationError,
  toPublicRubricAssessment,
  createGradedRubricResponseSchema,
  parseGradedRubricAssessment,
  toPublicGradedRubricAssessment,
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
const excerptDecisions = [
  { criterionId: 'C1', achieved: true, evidenceId: 'E1' },
  { criterionId: 'C2', achieved: false, evidenceId: null },
  { criterionId: 'C3', achieved: false, evidenceId: null },
  { criterionId: 'C4', achieved: false, evidenceId: null },
] as const;

if (process.env.VITEST) {
  const { describe, expect, it } = await import('vitest');

  describe('five-level rubric scoring', () => {
    const answer = "😀 I acknowledged the patient's frustration, but did not explore their concerns.";
    const graded = (levels: readonly number[]) => levels.map((performanceLevel, index) => ({
      criterionId: criteria[index].criterionId, performanceLevel,
      evidenceId: performanceLevel === 0 ? null : 'E1',
      justification: performanceLevel === 0 ? 'The answer does not demonstrate this criterion.'
        : 'The candidate acknowledged frustration but did not explore the reason for the concern.',
    }));

    it.each([0, 1, 2, 3, 4])('awards exactly %i quarters of the criterion weight', (level) => {
      const values = graded([level, 0, 0, 0]);
      const parsed = parseGradedRubricAssessment(JSON.stringify({ decisions: values }), criteria, answer);
      const result = toPublicGradedRubricAssessment(parsed, criteria, answer);
      expect(result.schemaVersion).toBe(4);
      expect(result.questionScorePct).toBe(level * 6.25);
      expect(result.criteria[0]).toEqual({
        criterionId: 'C1', performanceLevel: level, weightPct: 25,
        evidenceQuote: level === 0 ? null : answer, justification: values[0].justification,
      });
      expect(Object.isFrozen(result.criteria[0])).toBe(true);
      expect(JSON.stringify(result)).not.toContain('evidenceReference');
      expect(JSON.stringify(result)).not.toContain('evidenceId');
    });

    it('scores a basic demonstration as 12.5/25 and sums mixed levels to 43.75%', () => {
      const result = toPublicGradedRubricAssessment(
        parseGradedRubricAssessment(JSON.stringify({ decisions: graded([0, 1, 2, 4]) }), criteria, answer), criteria, answer,
      );
      expect(result.criteria[2].weightPct * result.criteria[2].performanceLevel / 4).toBe(12.5);
      expect(result.questionScorePct).toBe(43.75);
    });

    it.each(Array.from({ length: 20 }, (_, index) => index + 1))('uses database-compatible arithmetic for %i criteria', (count) => {
      const snapshot = Array.from({ length: count }, (_, index) => ({ criterionId: `C${index}`, bulletText: 'Criterion', domain: null }));
      const decisions = snapshot.map(({ criterionId }, index) => ({
        criterionId, performanceLevel: index % 5, evidenceId: index % 5 === 0 ? null : 'E1',
        justification: 'Specific answer evidence supports this performance level.',
      }));
      const result = toPublicGradedRubricAssessment(parseGradedRubricAssessment(JSON.stringify({ decisions }), snapshot, answer), snapshot, answer);
      const levelSum = decisions.reduce((sum, decision) => sum + decision.performanceLevel, 0);
      expect(result.questionScorePct).toBe(Math.round(levelSum * 2_500 / count) / 100);
      expect(result.criteria.every((criterion: { weightPct: number }) => criterion.weightPct === Math.round(100 / count * 1e8) / 1e8)).toBe(true);
    });

    it('requests exactly five levels, bounded justification, and server-issued evidence IDs', () => {
      expect(createGradedRubricResponseSchema(criteria, answer)).toMatchObject({
        additionalProperties: false, properties: { decisions: { minItems: 4, maxItems: 4, items: {
          additionalProperties: false,
          required: ['criterionId', 'performanceLevel', 'evidenceId', 'justification'],
          properties: {
            performanceLevel: { type: 'integer', enum: [0, 1, 2, 3, 4] },
            evidenceId: { anyOf: [{ type: 'string', enum: ['E1'] }, { type: 'null' }] },
            justification: { type: 'string', minLength: 1, maxLength: 600 },
          },
        } } },
      });
    });

    it.each([
      { performanceLevel: -1 }, { performanceLevel: 5 }, { performanceLevel: 1.5 },
      { performanceLevel: '2' }, { performanceLevel: true }, { evidenceId: null },
      { evidenceId: 'E999' }, { evidenceId: '__proto__' }, { evidenceId: { start: 0, end: 1 } },
      { justification: '' }, { justification: ' \n\t' }, { justification: 'a'.repeat(601) },
      { justification: null }, { criterionId: 'unknown' }, { score: 100 },
    ])('rejects malformed or fabricated decisions %j', (override) => {
      const decisions = graded([2, 1, 0, 4]);
      expect(() => parseGradedRubricAssessment(JSON.stringify({ decisions: [{ ...decisions[0], ...override }, ...decisions.slice(1)] }), criteria, answer)).toThrow('AI_PROVIDER_RESPONSE_INVALID');
    });

    it('requires each ordered criterion exactly once, with no provider-created totals', () => {
      const decisions = graded([0, 1, 2, 4]);
      for (const invalid of [decisions.slice(1), [...decisions, decisions[0]], [decisions[1], decisions[0], ...decisions.slice(2)], [decisions[0], decisions[0], ...decisions.slice(2)]]) {
        expect(() => parseGradedRubricAssessment(JSON.stringify({ decisions: invalid }), criteria, answer)).toThrow('AI_PROVIDER_RESPONSE_INVALID');
      }
      for (const raw of ['null', '[]', '{', JSON.stringify({ decisions, questionScorePct: 100 })]) {
        expect(() => parseGradedRubricAssessment(raw, criteria, answer)).toThrow('AI_PROVIDER_RESPONSE_INVALID');
      }
    });

    it('allows verified counter-evidence at level zero and retains Unicode-safe bounded excerpts', () => {
      const longAnswer = `😀${'a'.repeat(299)}${answer}`;
      const decisions = graded([0, 1, 2, 4]).map((decision) => ({ ...decision, evidenceId: 'E2' }));
      const parsed = parseGradedRubricAssessment(JSON.stringify({ decisions }), criteria, longAnswer);
      const result = toPublicGradedRubricAssessment(parsed, criteria, longAnswer);
      expect(result.criteria[0].performanceLevel).toBe(0);
      expect(result.criteria[0].evidenceQuote).toBe(Array.from(longAnswer).slice(150, 450).join(''));
      expect(Array.from(result.criteria[0].evidenceQuote ?? '').length).toBeLessThanOrEqual(300);
      expect(JSON.stringify(result)).not.toContain(longAnswer);
      expect(() => toPublicGradedRubricAssessment([{ ...parsed[0], evidenceReference: { start: 0, end: 1 } }, ...parsed.slice(1)], criteria, longAnswer)).toThrow('AI_PROVIDER_RESPONSE_INVALID');
      expect(() => toPublicGradedRubricAssessment([{ ...parsed[0], justification: '' }, ...parsed.slice(1)], criteria, longAnswer)).toThrow('AI_PROVIDER_RESPONSE_INVALID');
    });
  });

  describe('strict rubric assessment domain', () => {
  it('owns equal weighting and omits private evidence and transcript text', () => {
    const result = toPublicRubricAssessment(decisions, criteria, 'Safe escalation is required.');
    expect(result.questionScorePct).toBe(25);
    expect(result.criteria.map((item: { weightPct: number }) => item.weightPct)).toEqual([25, 25, 25, 25]);
    expect(JSON.stringify(result)).not.toContain('Safe escalation');
    expect(JSON.stringify(result)).not.toContain('evidenceReference');
  });

  it('matches eight-decimal database weights while keeping two-decimal question scores', () => {
    const five = Array.from({ length: 5 }, (_, index) => ({ criterionId: `C${index + 1}`, bulletText: `Criterion ${index + 1}`, domain: null }));
    const fiveDecisions = five.map((criterion, index) => ({ criterionId: criterion.criterionId, achieved: index < 3, evidenceReference: index < 3 ? { start: index, end: index + 1 } : null }));
    expect(toPublicRubricAssessment(fiveDecisions, five, 'abcde')).toMatchObject({ questionScorePct: 60, criteria: Array.from({ length: 5 }, () => ({ weightPct: 20 })) });
    expect(toPublicRubricAssessment(decisions.slice(0, 3), criteria.slice(0, 3), 'Safe escalation is required.')).toMatchObject({ questionScorePct: 33.33, criteria: Array.from({ length: 3 }, () => ({ weightPct: 33.33333333 })) });
  });

  it.each([
    [1, 100], [2, 50], [3, 33.33333333], [4, 25], [5, 20],
    [6, 16.66666667], [7, 14.28571429], [8, 12.5], [9, 11.11111111], [10, 10],
    [11, 9.09090909], [12, 8.33333333], [13, 7.69230769], [14, 7.14285714], [15, 6.66666667],
    [16, 6.25], [17, 5.88235294], [18, 5.55555556], [19, 5.26315789], [20, 5],
  ])('uses the exact database weight for %i criteria', (count, expectedWeight) => {
    const criterionSnapshot = Array.from({ length: count }, (_, index) => ({ criterionId: `C${index + 1}`, bulletText: 'Criterion', domain: null }));
    const assessmentDecisions = criterionSnapshot.map(({ criterionId }, index) => ({ criterionId, achieved: index === 0, evidenceReference: index === 0 ? { start: 0, end: 1 } : null }));
    const result = toPublicRubricAssessment(assessmentDecisions, criterionSnapshot, 'a');
    expect(result.criteria.every((criterion: { weightPct: number }) => criterion.weightPct === expectedWeight)).toBe(true);
    expect(result.questionScorePct).toBe(Math.round(10_000 / count) / 100);
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
    [1, 1], [149, 1], [150, 1], [299, 1], [300, 1], [301, 2],
    [449, 2], [450, 2], [451, 3], [12_000, 79],
  ])('covers all %i candidate code points with %i bounded deterministic excerpts', (length, count) => {
    const transcript = '😀'.repeat(length);
    const points = Array.from(transcript);
    const excerpts = createRubricEvidenceExcerpts(transcript);
    expect(excerpts).toHaveLength(count);
    expect(excerpts).toEqual(createRubricEvidenceExcerpts(transcript));
    const covered = new Set<number>();
    for (const [index, excerpt] of excerpts.entries()) {
      expect(excerpt.evidenceId).toBe(`E${index + 1}`);
      expect(Array.from(excerpt.text).length).toBeLessThanOrEqual(MAX_RUBRIC_EVIDENCE_EXCERPT_CODE_POINTS);
      expect(excerpt.text).toBe(points.slice(excerpt.evidenceReference.start, excerpt.evidenceReference.end).join(''));
      expect(Object.isFrozen(excerpt)).toBe(true);
      expect(Object.isFrozen(excerpt.evidenceReference)).toBe(true);
      for (let point = excerpt.evidenceReference.start; point < excerpt.evidenceReference.end; point += 1) covered.add(point);
    }
    expect(Object.isFrozen(excerpts)).toBe(true);
    expect(covered.size).toBe(length);
    expect(excerpts.at(-1)?.evidenceReference.end).toBe(length);
  });

  it('keeps Unicode boundary evidence intact in an overlapping server range', () => {
    const phrase = '😀 I would protect safety and escalate.';
    const transcript = `${'a'.repeat(280)}${phrase}${' café'.repeat(90)}`;
    const excerpts = createRubricEvidenceExcerpts(transcript);
    expect(excerpts[0].text).not.toContain(phrase);
    expect(excerpts[1].text).toContain(phrase);
    const parsed = parseRubricExcerptProviderAssessment(JSON.stringify({ decisions: [{ ...excerptDecisions[0], evidenceId: 'E2' }, ...excerptDecisions.slice(1)] }), criteria, transcript);
    expect(parsed).toEqual([
      { criterionId: 'C1', achieved: true, evidenceReference: { start: 150, end: 450 } },
      ...decisions.slice(1),
    ]);
    const publicAssessment = toPublicRubricAssessment(parsed, criteria, transcript);
    expect(publicAssessment).toMatchObject({ schemaVersion: 3, questionScorePct: 25 });
    expect(JSON.stringify(publicAssessment)).not.toContain('evidence');
    expect(JSON.stringify(publicAssessment)).not.toContain('café');
    expect(JSON.stringify(publicAssessment)).not.toContain(phrase);
  });

  it('skips whitespace-only windows while retaining meaningful tail evidence', () => {
    const transcript = `${' '.repeat(500)}Safe escalation`;
    const excerpts = createRubricEvidenceExcerpts(transcript);
    expect(excerpts).toEqual([{ evidenceId: 'E1', text: `${' '.repeat(200)}Safe escalation`, evidenceReference: { start: 300, end: 515 } }]);
    expect(parseRubricExcerptProviderAssessment(JSON.stringify({ decisions: excerptDecisions }), criteria, transcript)[0].evidenceReference).toEqual({ start: 300, end: 515 });
    expect(() => createRubricEvidenceExcerpts(' \n\t ')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
    expect(() => createRubricEvidenceExcerpts('a'.repeat(12_001))).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });

  it('limits the provider schema to exactly the generated evidence identifiers', () => {
    const transcript = 'a'.repeat(451);
    expect(createRubricExcerptResponseSchema(criteria, transcript)).toEqual({
      type: 'object', additionalProperties: false, required: ['decisions'],
      properties: { decisions: {
        type: 'array', minItems: 4, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['criterionId', 'achieved', 'evidenceId'],
          properties: {
            criterionId: { type: 'string', enum: ['C1', 'C2', 'C3', 'C4'] },
            achieved: { type: 'boolean' },
            evidenceId: { anyOf: [{ type: 'string', enum: ['E1', 'E2', 'E3'] }, { type: 'null' }] },
          },
        },
      } },
    });
    expect(JSON.stringify(createRubricExcerptResponseSchema(criteria, transcript))).not.toContain('evidenceQuote');
    expect(JSON.stringify(createRubricExcerptResponseSchema(criteria, transcript))).not.toContain('evidenceReference');
  });

  it.each([
    ['missing', excerptDecisions.slice(0, 3)],
    ['extra', [...excerptDecisions, excerptDecisions[3]]],
    ['duplicate', [excerptDecisions[0], excerptDecisions[0], ...excerptDecisions.slice(2)]],
    ['reordered', [excerptDecisions[1], excerptDecisions[0], ...excerptDecisions.slice(2)]],
    ['unknown criterion', [{ ...excerptDecisions[0], criterionId: 'OTHER' }, ...excerptDecisions.slice(1)]],
    ['non-boolean', [{ ...excerptDecisions[0], achieved: 'true' }, ...excerptDecisions.slice(1)]],
    ['positive null', [{ ...excerptDecisions[0], evidenceId: null }, ...excerptDecisions.slice(1)]],
    ['negative identifier', [excerptDecisions[0], { ...excerptDecisions[1], evidenceId: 'E1' }, ...excerptDecisions.slice(2)]],
    ['unknown identifier', [{ ...excerptDecisions[0], evidenceId: 'E999' }, ...excerptDecisions.slice(1)]],
    ['other answer identifier', [{ ...excerptDecisions[0], evidenceId: 'E2' }, ...excerptDecisions.slice(1)]],
    ['prototype identifier', [{ ...excerptDecisions[0], evidenceId: '__proto__' }, ...excerptDecisions.slice(1)]],
    ['case change', [{ ...excerptDecisions[0], evidenceId: 'e1' }, ...excerptDecisions.slice(1)]],
    ['space change', [{ ...excerptDecisions[0], evidenceId: 'E1 ' }, ...excerptDecisions.slice(1)]],
    ['numeric identifier', [{ ...excerptDecisions[0], evidenceId: 1 }, ...excerptDecisions.slice(1)]],
    ['provider offset', [{ ...excerptDecisions[0], evidenceId: { start: 0, end: 1 } }, ...excerptDecisions.slice(1)]],
    ['copied quote', quoteDecisions],
    ['additional quote', [{ ...excerptDecisions[0], evidenceQuote: 'Safe' }, ...excerptDecisions.slice(1)]],
  ])('rejects %s in provider excerpt decisions without awarding fallback credit', (_name, invalid) => {
    expect(() => parseRubricExcerptProviderAssessment(JSON.stringify({ decisions: invalid }), criteria, 'Safe escalation')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });

  it('accepts all-negative decisions and rejects malformed excerpt envelopes', () => {
    const negatives = excerptDecisions.map((decision) => ({ ...decision, achieved: false, evidenceId: null }));
    expect(parseRubricExcerptProviderAssessment(JSON.stringify({ decisions: negatives }), criteria, 'Safe escalation')).toEqual(decisions.map((decision) => ({ ...decision, achieved: false, evidenceReference: null })));
    for (const raw of ['{"decisions":[', 'null', '[]', JSON.stringify({ decisions: excerptDecisions, score: 100 })]) {
      expect(() => parseRubricExcerptProviderAssessment(raw, criteria, 'Safe escalation')).toThrow('AI_PROVIDER_RESPONSE_INVALID');
    }
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
    ['envelope', '{"decisions":[', 'Safe escalation'],
    ['count', JSON.stringify({ decisions: quoteDecisions.slice(0, 3) }), 'Safe escalation'],
    ['order', JSON.stringify({ decisions: [quoteDecisions[1], quoteDecisions[0], ...quoteDecisions.slice(2)] }), 'Safe escalation'],
    ['quote_null', JSON.stringify({ decisions: [{ ...quoteDecisions[0], evidenceQuote: null }, ...quoteDecisions.slice(1)] }), 'Safe escalation'],
    ['quote_null', JSON.stringify({ decisions: [quoteDecisions[0], { ...quoteDecisions[1], evidenceQuote: 'Safe' }, ...quoteDecisions.slice(2)] }), 'Safe escalation'],
    ['quote_too_long', JSON.stringify({ decisions: [{ ...quoteDecisions[0], evidenceQuote: 'a'.repeat(301) }, ...quoteDecisions.slice(1)] }), 'a'.repeat(301)],
    ['quote_not_found', JSON.stringify({ decisions: [{ ...quoteDecisions[0], evidenceQuote: 'Private invented evidence' }, ...quoteDecisions.slice(1)] }), 'Safe escalation'],
    ['internal', JSON.stringify({ decisions: [{ ...quoteDecisions[0], evidenceQuote: '\ude00' }, ...quoteDecisions.slice(1)] }), '😀'],
  ])('reports only the fixed %s validation label', (reason, raw, transcript) => {
    let captured: unknown;
    try {
      parseRubricQuoteProviderAssessment(raw, criteria, transcript);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(RubricAssessmentValidationError);
    expect(captured).toMatchObject({ message: 'AI_PROVIDER_RESPONSE_INVALID', reason });
    expect(Object.keys(captured as object).sort()).toEqual(['name', 'reason']);
    expect(JSON.stringify(captured)).not.toContain('Private invented evidence');
    expect(JSON.stringify(captured)).not.toContain('C1');
  });

  it('normalizes unrecognized diagnostic labels without retaining arbitrary text', () => {
    const error = new RubricAssessmentValidationError('Private unexpected text' as never);
    expect(error.reason).toBe('internal');
    expect(JSON.stringify(error)).not.toContain('Private unexpected text');
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
