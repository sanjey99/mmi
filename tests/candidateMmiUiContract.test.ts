import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const practiceScreenPath = resolve(process.cwd(), 'app/(tabs)/practice.tsx');
const candidateStationPath = resolve(process.cwd(), 'app/practice/mmi-station.tsx');
const browserSpeechMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260831000000_candidate_mmi_browser_speech.sql',
);

function readCandidateStationRoute(): string {
  expect(existsSync(candidateStationPath), 'Candidate MMI station route must exist behind the feature gate.').toBe(true);
  return readFileSync(candidateStationPath, 'utf8');
}

function readBrowserSpeechMigration(): string {
  expect(
    existsSync(browserSpeechMigrationPath),
    'Browser-speech persistence must be introduced through its own forward migration.',
  ).toBe(true);
  return readFileSync(browserSpeechMigrationPath, 'utf8');
}

describe('candidate MMI chooser and station route contract', () => {
  it('adds an 11-minute gated candidate station entry without replacing the flat-question chooser', () => {
    const practiceSource = readFileSync(practiceScreenPath, 'utf8');

    expect(practiceSource).toMatch(/isNormalizedMmiStationEnabled/);
    expect(practiceSource).toContain('/practice/mmi-station');
    expect(practiceSource).toMatch(/11[ -]minute/i);
    expect(practiceSource).toContain('getRandomQuestion');
    expect(practiceSource).toContain('startSession');
    expect(practiceSource).toContain('/practice/session');
  });

  it('gates direct station access and falls back safely while disabled', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/isNormalizedMmiStationEnabled/);
    expect(routeSource).toMatch(/router\.(?:replace|push)\('\/\(tabs\)\/practice'\)/);
  });

  it('uses runner restore for a session URL and start only when the session ID is absent', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/useLocalSearchParams/);
    expect(routeSource).toMatch(/runner\(\)\.restore\(sessionId\)/);
    expect(routeSource).toMatch(/runner\(\)\.start\(\)/);
    expect(routeSource).toMatch(/router\.replace\([\s\S]*sessionId/);
  });

  it('renders only the current trusted phase content and exact 60/120 timing boundaries', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/scenarioText/);
    expect(routeSource).toMatch(/promptText/);
    expect(routeSource).toMatch(/promptOrder/);
    expect(routeSource).toMatch(/60/);
    expect(routeSource).toMatch(/120/);
    expect(routeSource).not.toMatch(/futurePrompts|promptText[s]?\s*\.map|subQuestions|questionText[s]?\s*\.map/i);
  });

  it('contains no typed-answer, capture, scoring, or storage surface and supports terminal leave behavior', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/completed/);
    expect(routeSource).toMatch(/abandoned/);
    expect(routeSource).toMatch(/runner\(\)\.leave\(\)/);
    expect(routeSource).not.toMatch(/TextInput|typed answer|MediaRecorder|camera|storage|upload|score|scoring|rubric|model answer/i);
  });

  it('keeps browser-speech transcript persistence private, RPC-only, and free of media storage', () => {
    const sql = readBrowserSpeechMigration();

    for (const table of [
      'candidate_mmi_station_prompt_snapshots',
      'candidate_mmi_station_response_drafts',
      'candidate_mmi_station_responses',
      'candidate_mmi_response_scoring_claims',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
      expect(sql).toMatch(new RegExp(`REVOKE ALL(?: PRIVILEGES)? ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`, 'i'));
    }

    for (const functionName of [
      'checkpoint_candidate_mmi_station_response',
      'finalize_candidate_mmi_station_response',
      'get_candidate_mmi_station_feedback',
      'claim_candidate_mmi_response_scoring',
      'complete_candidate_mmi_response_scoring',
      'fail_candidate_mmi_response_scoring',
      'purge_expired_candidate_mmi_free_text',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\s*\\(`, 'i'));
    }

    expect(sql).toMatch(/SET search_path = public, pg_temp/g);
    expect(sql.match(/SET search_path = public, pg_temp/g)?.length).toBeGreaterThanOrEqual(10);
    expect(sql).toMatch(/char_length\(transcript\) <= 12000/i);
    expect(sql).toMatch(/finalized_transcript[\s\S]*char_length\(finalized_transcript\) <= 12000/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.checkpoint_candidate_mmi_station_response\(uuid, smallint, text, bigint\)\s+TO authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.finalize_candidate_mmi_station_response\(uuid, smallint, uuid\)\s+TO authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_candidate_mmi_station_feedback\(uuid\)\s+TO authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_candidate_mmi_response_scoring\(uuid, uuid, smallint, uuid\)\s+TO service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.purge_expired_candidate_mmi_free_text\(timestamptz\)\s+TO service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.mmi_stations FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.mmi_sub_questions FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/audio|blob|bucket|storage|recorder/i);
  });
});
