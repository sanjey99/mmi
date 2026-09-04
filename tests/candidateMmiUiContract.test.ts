import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const practiceScreenPath = resolve(process.cwd(), 'app/(tabs)/practice.tsx');
const candidateStationPath = resolve(process.cwd(), 'app/practice/mmi-station.tsx');
const legacySessionPath = resolve(process.cwd(), 'app/practice/session.tsx');
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

describe('single MMI station route contract', () => {
  it('exposes one neutral 11-minute station instead of competing flat-question modes', () => {
    const practiceSource = readFileSync(practiceScreenPath, 'utf8');

    expect(practiceSource).toContain('/practice/mmi-station');
    expect(practiceSource).toContain('11-minute MMI station');
    expect(practiceSource).not.toMatch(/isNormalizedMmiStationEnabled|candidateEnabled|app_config/);
    expect(practiceSource).not.toMatch(/Free practice|Timed practice|getRandomQuestion|startSession|\/practice\/session/);
  });

  it('opens the station without a product flag and retires the legacy response route', () => {
    const routeSource = readCandidateStationRoute();
    const legacySessionSource = readFileSync(legacySessionPath, 'utf8');

    expect(routeSource).not.toMatch(/isNormalizedMmiStationEnabled|feature_disabled|candidate station/i);
    expect(legacySessionSource).toContain("router.replace('/(tabs)/practice')");
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

  it('offers a no-timer microphone preflight before a new station starts', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/Test microphone/);
    expect(routeSource).toMatch(/Start station/);
    expect(routeSource).toMatch(/Browser speech service/);
    expect(routeSource).toMatch(/does not record or store\s+audio/i);
    expect(routeSource).toMatch(/transcript is saved/i);
    expect(routeSource).toMatch(/startStation/);
    expect(routeSource).toMatch(/speechPort\(\)\.preflight/);
  });

  it('composes editable browser speech with checkpointing and deadline freeze', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/TextInput/);
    expect(routeSource).toMatch(/accessibilityLabel="Your response transcript"/);
    expect(routeSource).toMatch(/CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS/);
    expect(routeSource).toMatch(/createBrowserSpeechPort/);
    expect(routeSource).toMatch(/createTranscriptState/);
    expect(routeSource).toMatch(/reduceTranscript/);
    expect(routeSource).toMatch(/Resume microphone/);
    expect(routeSource).toMatch(/Manual typing remains available/);
    expect(routeSource).toMatch(/runner\(\)[\s\S]*?\.checkpoint/);
    expect(routeSource).toMatch(/2_000/);
    expect(routeSource).toMatch(/visibilitychange/);
    expect(routeSource).toMatch(/pagehide/);
    expect(routeSource).toMatch(/type: 'freeze'/);
    expect(routeSource).toMatch(/(?:speechPort\(\)|currentSpeechPort)\.stop/);
  });

  it('uses retry-stable finalization identities and transcript-free finalization calls', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/sessionStorage/);
    expect(routeSource).toMatch(/candidate-mmi-finalization:/);
    expect(routeSource).toMatch(/crypto/);
    expect(routeSource).toMatch(/randomUUID/);
    expect(routeSource).toMatch(/expireCurrentPhase\(finalizationKey/);
    expect(routeSource).not.toMatch(/expireCurrentPhase\([^)]*transcript/);
  });

  it('scores asynchronously and renders ordered transcript-only feedback after completion', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/createCandidateMmiScoringApi/);
    expect(routeSource).toMatch(/scoreCandidateResponse/);
    expect(routeSource).toMatch(/\.feedback\(/);
    expect(routeSource).toMatch(/3_000/);
    expect(routeSource).toMatch(/60_000/);
    expect(routeSource).toMatch(/Overall score/);
    expect(routeSource).toMatch(/Improvement tip/);
    expect(routeSource).toMatch(/Transcript-only feedback/);
    expect(routeSource).not.toMatch(/accent evaluation|speaking pace|eye contact|body language/i);
  });

  it('contains no browser media capture or audio persistence surface and supports terminal leave behavior', () => {
    const routeSource = readCandidateStationRoute();

    expect(routeSource).toMatch(/completed/);
    expect(routeSource).toMatch(/abandoned/);
    expect(routeSource).toMatch(/runner\(\)\.leave\(\)/);
    expect(routeSource).not.toMatch(/MediaRecorder|camera|video|Blob|audioUrl|storage\.from|upload\(/i);
  });

  it('keeps browser-speech transcript persistence private, RPC-only, and free of media storage', () => {
    const sql = readBrowserSpeechMigration();
    const rlsStatements = sql.match(/ALTER TABLE[\s\S]*?ENABLE ROW LEVEL SECURITY;/gi) ?? [];
    const tableRevokeStatements = sql.match(/REVOKE ALL(?: PRIVILEGES)? ON TABLE[\s\S]*?;/gi) ?? [];
    const authenticatedGrantStatements = sql.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO authenticated;/gi) ?? [];
    const serviceGrantStatements = sql.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/gi) ?? [];

    for (const table of [
      'candidate_mmi_station_prompt_snapshots',
      'candidate_mmi_station_response_drafts',
      'candidate_mmi_station_responses',
      'candidate_mmi_response_scoring_claims',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${table}`, 'i'));
      expect(rlsStatements.some((statement) => statement.includes(`public.${table}`))).toBe(true);
      expect(tableRevokeStatements.some((statement) => statement.includes(`public.${table}`)
        && /FROM PUBLIC, anon, authenticated/i.test(statement))).toBe(true);
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
    expect(sql).toMatch(/COALESCE\(v_draft\.transcript, ''\) ~ '\^\[\[:space:\]\]\*\$'/i);
    expect(sql).not.toMatch(/btrim\(COALESCE\(v_draft\.transcript, ''\)\) = ''/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_valid_candidate_mmi_public_assessment/i);
    expect(sql).toMatch(/is_valid_candidate_mmi_public_assessment\(public_assessment\)/i);
    expect(sql).toMatch(/p_user_id uuid[\s\S]*p_session_id uuid[\s\S]*p_prompt_order smallint[\s\S]*p_lease_token uuid/i);
    expect(sql).toMatch(/session\.user_id = p_user_id/i);
    expect(sql).toMatch(/'responseId', v_response\.id/i);
    expect(sql).toMatch(/'scoringContract', v_snapshot\.scoring_contract_snapshot/i);
    for (const signature of [
      'checkpoint_candidate_mmi_station_response\\(uuid, smallint, text, bigint\\)',
      'finalize_candidate_mmi_station_response\\(uuid, smallint, uuid\\)',
      'get_candidate_mmi_station_feedback\\(uuid\\)',
    ]) {
      expect(authenticatedGrantStatements.some((statement) => new RegExp(signature, 'i').test(statement))).toBe(true);
    }
    for (const signature of [
      'claim_candidate_mmi_response_scoring\\(uuid, uuid, smallint, uuid\\)',
      'purge_expired_candidate_mmi_free_text\\(timestamptz\\)',
    ]) {
      expect(serviceGrantStatements.some((statement) => new RegExp(signature, 'i').test(statement))).toBe(true);
    }
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.mmi_stations FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.mmi_sub_questions FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/audio|blob|bucket|storage|recorder/i);
  });

  it('uses PostgreSQL-valid individual RLS alterations for every private transcript table', () => {
    const sql = readBrowserSpeechMigration();

    for (const table of [
      'candidate_mmi_station_prompt_snapshots',
      'candidate_mmi_station_response_drafts',
      'candidate_mmi_station_responses',
      'candidate_mmi_response_scoring_claims',
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, 'i'));
    }
  });
});
