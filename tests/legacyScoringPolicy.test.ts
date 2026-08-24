import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260825000000_cofounder_preview_scoring.sql',
);

function compactSql() {
  return (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

describe('cofounder preview legacy scoring policy', () => {
  it('uses one durable claim per user/session/question and records provider attempts', () => {
    const sql = compactSql();

    expect(sql).toContain('create table public.legacy_scoring_claims');
    expect(sql).toContain('unique (user_id, session_id, question_id)');
    expect(sql).toContain('create table public.legacy_scoring_attempts');
    expect(sql).toContain("status in ('pending', 'succeeded', 'failed')");
    expect(sql).toContain('lease_expires_at');
    expect(sql).toContain('answer_hash');
  });

  it('keeps claims and attempts service-only and closes legacy client mutation paths', () => {
    const sql = compactSql();

    expect(sql).toContain('alter table public.legacy_scoring_claims enable row level security');
    expect(sql).toContain('alter table public.legacy_scoring_attempts enable row level security');
    expect(sql).toMatch(/revoke all on (table )?public\.legacy_scoring_claims from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on (table )?public\.legacy_scoring_attempts from public, anon, authenticated/);
    expect(sql).toContain('revoke insert, update, delete on table public.answers from authenticated');
    expect(sql).toContain('revoke insert, update, delete on table public.scores from authenticated');
    expect(sql).toContain('revoke update, delete on table public.mock_sessions from authenticated');
    expect(sql).toContain('revoke update on table public.profiles from authenticated');
    expect(sql).toContain('grant update (full_name, avatar_url, university_target, entry_year, daily_goal, onboarding_complete, updated_at) on table public.profiles to authenticated');
    expect(sql).toContain('revoke execute on function public.update_streak(uuid) from public, anon, authenticated');
  });

  it('exposes fixed hardened claim, completion, and failure RPCs only to service_role', () => {
    const sql = compactSql();

    for (const name of ['claim_legacy_scoring', 'complete_legacy_scoring', 'fail_legacy_scoring']) {
      expect(sql).toContain(`function public.${name}`);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+ from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+ to service_role`));
    }
    expect(sql.match(/security definer/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/set search_path = pg_catalog, public/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('binds ownership and active content, locks the logical claim, and rejects changed bodies', () => {
    const sql = compactSql();

    expect(sql).toContain('mock_sessions.user_id = p_user_id');
    expect(sql).toContain('questions.is_active = true');
    expect(sql).toContain('for update');
    expect(sql).toContain("raise exception using message = 'answer_conflict'");
    expect(sql).toContain("raise exception using message = 'submission_unavailable'");
    expect(sql).toContain("'in_progress'");
    expect(sql).toContain('if v_session.completed then');
    expect((sql.match(/p_answer_hash is null/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('p_structure is null');
  });

  it('rate-limits acquired provider attempts and computes the overall score in SQL', () => {
    const sql = compactSql();

    expect(sql).toContain('legacy_scoring_attempts');
    expect(sql).toContain("interval '1 hour'");
    expect(sql).toContain('>= 20');
    expect(sql).toContain("raise exception using message = 'rate_limited'");
    expect(sql).toMatch(/v_overall_pct\s*:=\s*round\(\(\(p_structure \+ p_ethics \+ p_communication \+ p_reflection \+ p_nhs_awareness\)/);
    expect(sql).toContain('update public.mock_sessions');
    expect(sql).toContain('update public.profiles');
  });
});
