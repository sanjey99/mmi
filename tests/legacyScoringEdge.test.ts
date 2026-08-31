import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const edgeSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/score-answer/index.ts'),
  'utf8',
);
const storeSource = readFileSync(
  resolve(process.cwd(), 'src/stores/practiceStore.ts'),
  'utf8',
);
const sessionSource = readFileSync(
  resolve(process.cwd(), 'app/practice/session.tsx'),
  'utf8',
);

describe('server-owned legacy scoring edge contract', () => {
  it('accepts a bounded body without caller-supplied identity or question text', () => {
    expect(edgeSource).toContain('readBoundedJson');
    expect(edgeSource).toContain('sessionId');
    expect(edgeSource).toContain('questionId');
    expect(edgeSource).toContain('answerText');
    expect(edgeSource).not.toMatch(/body[^;]*questionText/s);
    expect(edgeSource).not.toMatch(/body[^;]*userId/s);
  });

  it('claims before the provider, uses the authoritative prompt, and completes or fails through RPCs', () => {
    const configuration = edgeSource.indexOf(".from('app_config')");
    const claim = edgeSource.indexOf("rpc('claim_legacy_scoring'");
    const provider = edgeSource.indexOf('await callConfiguredProvider');
    const complete = edgeSource.indexOf("rpc('complete_legacy_scoring'");

    expect(configuration).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(configuration);
    expect(provider).toBeGreaterThan(claim);
    expect(complete).toBeGreaterThan(provider);
    expect(edgeSource).toContain('claim.question_text');
    expect(edgeSource).toContain("rpc('fail_legacy_scoring'");
  });

  it('emits only the allowlisted provider-failure diagnostic while retaining public error classifications', () => {
    expect(edgeSource).toContain('ProviderRequestError');
    expect(edgeSource).toContain('providerFailureDiagnostic');
    expect(edgeSource).toContain("request.headers.get('x-request-id')");
    expect(edgeSource).toContain("'invalid_provider_response'");
    expect(edgeSource).toContain("'provider_failed'");
    expect(edgeSource).toMatch(/console\.error\(providerFailureDiagnostic\(/);
    expect(edgeSource).not.toMatch(/console\.error\([^)]*error/);
  });

  it('removes direct answer, score, session-finalisation, and streak writes from the client store', () => {
    expect(storeSource).not.toMatch(/from\('answers'\)[\s\S]{0,180}\.insert\(/);
    expect(storeSource).not.toMatch(/from\('scores'\)[\s\S]{0,180}\.insert\(/);
    expect(storeSource).not.toContain("rpc('update_streak'");
    expect(storeSource).not.toMatch(/from\('mock_sessions'\)[\s\S]{0,180}\.update\(\{ total_score_pct/);
  });

  it('renders reviewed scoring errors instead of collapsing every failure into one message', () => {
    expect(sessionSource).toContain('LegacyScoringError');
    expect(sessionSource).toContain('error.message');
  });
});
