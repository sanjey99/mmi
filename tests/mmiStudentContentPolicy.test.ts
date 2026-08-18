import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const migrationPath = fileURLToPath(
  new URL(
    '../supabase/migrations/20260817001000_mmi_student_content_api.sql',
    import.meta.url,
  ),
);

const functionNames = [
  'list_mmi_station_cards',
  'get_mmi_station_preview',
  'get_next_mmi_station_preview',
] as const;

const hiddenContentPattern =
  /model_answer_cached|actor_persona|background_info|question_text|rubric/i;

function readMigration() {
  return readFileSync(migrationPath, 'utf8');
}

function functionBody(sql: string, name: (typeof functionNames)[number]) {
  const match = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$function\\$([\\s\\S]*?)\\$function\\$`,
      'i',
    ),
  );

  assert.ok(match, `expected ${name} to use a delimited function body`);
  return match[1];
}

function functionDeclaration(
  sql: string,
  name: (typeof functionNames)[number],
) {
  const match = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$function\\$`,
      'i',
    ),
  );

  assert.ok(match, `expected ${name} to be declared`);
  return match[0];
}

describe('MMI student content SQL policy', () => {
  it('revokes every direct client privilege on assessor-bearing tables', () => {
    const sql = readMigration();

    for (const table of [
      'mmi_stations',
      'mmi_sub_questions',
      'roleplay_stations',
    ]) {
      assert.match(
        sql,
        new RegExp(
          `revoke\\s+all(?:\\s+privileges)?\\s+on(?:\\s+table)?\\s+public\\.${table}\\s+from\\s+anon\\s*,\\s*authenticated`,
          'i',
        ),
      );
    }
  });

  it('defines hardened RPCs with explicit authorization and closed grants', () => {
    const sql = readMigration();

    for (const name of functionNames) {
      const declaration = functionDeclaration(sql, name);
      const body = functionBody(sql, name);

      assert.match(declaration, /security\s+definer/i);
      assert.match(declaration, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
      assert.match(declaration, /\bstable\b/i);
      assert.match(body, /auth\.uid\s*\(\s*\)/i);
      assert.match(body, /auth\.role\s*\(\s*\)/i);
      assert.match(body, /errcode\s*=\s*'42501'/i);

      assert.match(
        sql,
        new RegExp(
          `revoke\\s+all(?:\\s+privileges)?\\s+on\\s+function\\s+public\\.${name}\\([^;]+\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ),
      );
      assert.match(
        sql,
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]+\\)\\s+to\\s+authenticated`,
          'i',
        ),
      );
    }
  });

  it('uses fixed safe projections that exclude hidden and future content', () => {
    const sql = readMigration();
    const studentProjection = functionNames
      .map((name) => functionDeclaration(sql, name))
      .join('\n');

    assert.match(sql, /model_answer_cached/i);
    assert.doesNotMatch(studentProjection, hiddenContentPattern);
    assert.doesNotMatch(studentProjection, /returns\s+setof\s+record/i);
    assert.doesNotMatch(
      functionNames.map((name) => functionBody(sql, name)).join('\n'),
      /select\s+\*/i,
    );

    assert.match(
      functionDeclaration(sql, 'list_mmi_station_cards'),
      /returns\s+table\s*\(\s*station_kind\s+text\s*,\s*station_id\s+text\s*,\s*title\s+text\s*,\s*category\s+text\s*,\s*topic\s+text\s*,\s*difficulty\s+text\s*,\s*university_tags\s+text\[\]\s*,\s*prep_time_sec\s+integer\s*,\s*prompt_count\s+integer\s*\)/i,
    );
    assert.match(
      functionDeclaration(sql, 'get_mmi_station_preview'),
      /prompt_count\s+integer\s*,\s*student_brief\s+text\s*,\s*opening_line\s+text/i,
    );
  });

  it('limits discovery to published rows with escaped, bounded filters', () => {
    const sql = readMigration();
    const listBody = functionBody(sql, 'list_mmi_station_cards');

    assert.ok(
      (listBody.match(/status::text\s*=\s*'published'/gi) ?? []).length >= 2,
      'both station sources must enforce published status',
    );
    assert.match(listBody, /least\s*\(\s*greatest[\s\S]*?50\s*\)/i);
    assert.match(listBody, /greatest\s*\(\s*coalesce\s*\(\s*p_offset\s*,\s*0\s*\)\s*,\s*0\s*\)/i);
    assert.match(listBody, /replace\s*\([\s\S]*?'%'\s*,\s*'\\%'/i);
    assert.match(listBody, /replace\s*\([\s\S]*?'_'\s*,\s*'\\_'/i);
    assert.match(listBody, /escape\s+'\\'/i);
    assert.match(listBody, /order\s+by\s+c\.title\s*,\s*c\.station_kind\s*,\s*c\.station_id/i);
  });

  it('keeps preview and next-station lookup published and deterministic', () => {
    const sql = readMigration();
    const previewBody = functionBody(sql, 'get_mmi_station_preview');
    const nextBody = functionBody(sql, 'get_next_mmi_station_preview');

    assert.ok(
      (previewBody.match(/status::text\s*=\s*'published'/gi) ?? []).length >= 2,
      'preview must check both station sources',
    );
    assert.ok(
      (nextBody.match(/status::text\s*=\s*'published'/gi) ?? []).length >= 2,
      'next preview must check both station sources',
    );
    assert.match(nextBody, /<>\s*\(\s*p_kind\s*,\s*p_station_id\s*\)/i);
    assert.match(nextBody, /c\.title\s*,\s*c\.station_kind\s*,\s*c\.station_id/i);
  });
});
