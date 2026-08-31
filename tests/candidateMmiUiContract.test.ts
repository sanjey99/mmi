import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const practiceScreenPath = resolve(process.cwd(), 'app/(tabs)/practice.tsx');
const candidateStationPath = resolve(process.cwd(), 'app/practice/mmi-station.tsx');

function readCandidateStationRoute(): string {
  expect(existsSync(candidateStationPath), 'Candidate MMI station route must exist behind the feature gate.').toBe(true);
  return readFileSync(candidateStationPath, 'utf8');
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
});
