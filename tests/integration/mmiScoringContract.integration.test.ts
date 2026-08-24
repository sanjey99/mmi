import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url).href);
const migrationPath = fileURLToPath(new URL('../../supabase/migrations/20260817003000_mmi_submission_rpcs.sql', import.meta.url).href);
const url = process.env.SUPABASE_TEST_URL;
const required = process.env.MMI_SCORING_INTEGRATION_REQUIRED === '1';
const disposableLocal = url !== undefined && ['localhost', '127.0.0.1'].includes(new URL(url).hostname);

if (url && !disposableLocal) throw new Error('MMI scoring integration tests only run against a disposable local Supabase URL');
if (required && !disposableLocal) throw new Error('Required disposable local MMI scoring integration credentials are missing');

describe('MMI scoring deployment contracts', () => {
  it('JWT-verifies the scoring and continuation endpoints', () => {
    const config = readFileSync(configPath, 'utf8');
    for (const name of ['score-mmi-prompt', 'continue-mmi-attempt']) {
      const section = config.match(new RegExp(`\\[functions\\.${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i'));
      assert.ok(section, `missing [functions.${name}]`);
      assert.match(section[1], /^verify_jwt\s*=\s*true\s*$/mi);
    }
  });

  it('closes every submission RPC to browser roles and grants only service role', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const signatures = [
      'claim_mmi_scoring_submission\\(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT\\)',
      'complete_mmi_scoring_submission\\(UUID, UUID, TEXT, JSONB, UUID, INTEGER\\)',
      'fail_mmi_scoring_submission\\(UUID, UUID, TEXT\\)',
      'advance_mmi_attempt_after_feedback\\(UUID, UUID\\)',
    ];
    for (const signature of signatures) {
      assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON FUNCTION public\\.${signature} FROM PUBLIC, anon, authenticated`, 'i'));
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role`, 'i'));
    }
    for (const name of ['claim_mmi_scoring_submission', 'complete_mmi_scoring_submission', 'fail_mmi_scoring_submission', 'advance_mmi_attempt_after_feedback']) {
      assert.match(sql, new RegExp(`FUNCTION public\\.${name}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public, pg_temp`, 'i'));
    }
  });
});

// This suite deliberately contains no fixture cleanup. A future authorized run may leave
// unique synthetic rows behind; it cannot run unless MMI_SCORING_INTEGRATION_REQUIRED=1
// and the target is localhost/127.0.0.1.
