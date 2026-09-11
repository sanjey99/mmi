import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('admin MMI workspace contract', () => {
  it('exposes the inspectable MMI operations dashboard', () => {
    const dashboard = read('app/admin/index.tsx');

    expect(dashboard).toMatch(/Station repository/);
    expect(dashboard).toMatch(/Panel library/);
    expect(dashboard).toMatch(/AI configuration/);
    expect(dashboard).toMatch(/Usage and costs/);
    expect(dashboard).toMatch(/Assessment explorer/);
    expect(dashboard).toMatch(/getDashboard/);
  });

  it('keeps the station editor complete, versioned, and non-destructive', () => {
    const editorPath = 'app/admin/station-editor.tsx';
    expect(existsSync(resolve(root, editorPath))).toBe(true);
    const editor = read(editorPath);

    expect(editor).toMatch(/five ordered questions/i);
    expect(editor).toMatch(/marking criteria/i);
    expect(editor).toMatch(/equal percentage/i);
    expect(editor).toMatch(/expectedVersion/);
    expect(editor).toMatch(/version_conflict/);
    expect(editor).not.toMatch(/deleteStation|delete_admin_mmi_station|\/delete/i);
  });

  it('uses the narrow admin API for configuration and marks rates as future-only', () => {
    const aiConfig = read('app/admin/ai-config.tsx');

    expect(aiConfig).toMatch(/MODEL/);
    expect(aiConfig).toMatch(/INPUT RATE/);
    expect(aiConfig).toMatch(/createAdminMmiApi/);
    expect(aiConfig).toMatch(/saveAiConfig/);
    expect(aiConfig).toMatch(/future calls only/i);
    expect(aiConfig).not.toMatch(/\.from\('app_config'\)/);
  });

  it('keeps questions links compatible and preserves the admin route guard', () => {
    const questions = read('app/admin/questions.tsx');
    const layout = read('app/admin/_layout.tsx');

    expect(questions).toMatch(/router\.replace\('\/admin\/stations'\)/);
    expect(layout).toMatch(/profile\?\.is_admin/);
  });

  it('never renders private answer material in assessment exploration', () => {
    const detailPath = 'app/admin/assessment.tsx';
    expect(existsSync(resolve(root, detailPath))).toBe(true);
    const detail = read(detailPath);

    expect(detail).toMatch(/getAssessment/);
    expect(detail).toMatch(/Rubric checklist/);
    expect(detail).not.toMatch(/transcript|answer text|evidence excerpt|raw response/i);
  });

  it('labels panel content outside the candidate 11-minute practice pool and unknown costs honestly', () => {
    const panels = read('app/admin/panels.tsx');
    const usage = read('app/admin/usage.tsx');

    expect(panels).toMatch(/outside the 11-minute candidate practice pool/i);
    expect(usage).toMatch(/Cost unavailable/);
  });
});
