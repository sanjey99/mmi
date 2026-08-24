import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260825002000_cofounder_feedback.sql',
), 'utf8');
const home = readFileSync(resolve(process.cwd(), 'app/(tabs)/index.tsx'), 'utf8');
const feedbackScreen = readFileSync(resolve(process.cwd(), 'app/cofounder-feedback.tsx'), 'utf8');
const feedbackApi = readFileSync(resolve(
  process.cwd(),
  'src/features/cofounderFeedback/api.ts',
), 'utf8');

describe('cofounder feedback policy', () => {
  it('keeps the table service-only and exposes two hardened RPCs', () => {
    expect(migration).toMatch(/CREATE TABLE public\.cofounder_feedback/i);
    expect(migration).toMatch(/ALTER TABLE public\.cofounder_feedback ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.cofounder_feedback FROM PUBLIC, anon, authenticated/i);
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(2);
  });

  it('binds inserts to auth, rate limits durably, and checks admin review access', () => {
    expect(migration).toMatch(/v_user_id uuid := auth\.uid\(\)/i);
    expect(migration).toMatch(/pg_advisory_xact_lock/i);
    expect(migration).toMatch(/created_at >= now\(\) - interval '1 hour'/i);
    expect(migration).toMatch(/v_recent_count >= 10/i);
    expect(migration).toMatch(/p_category IS NULL[\s\S]*p_app_version IS NULL/i);
    expect(migration).toMatch(/p\.id = v_user_id[\s\S]*p\.is_admin IS TRUE/i);
    expect(migration).toMatch(/CASE WHEN f\.allow_reply THEN f\.user_id ELSE NULL END/i);
  });

  it('exposes a visible privacy-minimal feedback entry point', () => {
    expect(home).toContain("router.push('/cofounder-feedback')");
    expect(feedbackScreen).toContain('No answers, transcripts, screenshots, tokens, or browser logs are attached.');
    expect(feedbackApi).not.toMatch(/p_(answer|transcript|screenshot|token|log)/i);
  });
});
