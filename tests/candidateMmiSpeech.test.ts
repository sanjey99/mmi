import { describe, expect, it, vi } from 'vitest';

import {
  CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS,
  createTranscriptState,
  reduceTranscript,
} from '../src/features/candidateMmi/transcript';
import { createBrowserSpeechPort } from '../src/features/candidateMmi/speechPort';

const responseOne = 'station-1:1:2026-08-31T00:01:00.000Z';
const responseTwo = 'station-1:2:2026-08-31T00:03:00.000Z';

class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly abort = vi.fn();

  emitResult(...results: Array<{ isFinal: boolean; transcript: string }>) {
    this.onresult?.({
      resultIndex: 0,
      results: results.map(result => ({ isFinal: result.isFinal, 0: { transcript: result.transcript } })),
    });
  }
}

function fakeConstructor(instances: FakeRecognition[]) {
  return class extends FakeRecognition {
    constructor() {
      super();
      instances.push(this);
    }
  };
}

describe('candidate MMI transcript reducer', () => {
  it('preserves restored and manual whitespace while appending normalized final fragments immutably', () => {
    const restored = reduceTranscript(createTranscriptState(responseOne), {
      type: 'restore', responseIdentity: responseOne, text: '  I would listen\nfirst  ', revision: 4,
    });
    const manuallyEdited = reduceTranscript(restored, {
      type: 'manualReplace', responseIdentity: responseOne, text: 'I would listen\ncarefully first',
    });
    const appended = reduceTranscript(manuallyEdited, {
      type: 'finalFragment', responseIdentity: responseOne, text: '  and\nchecked understanding  ',
    });

    expect(restored).toMatchObject({ committedText: '  I would listen\nfirst  ', interimText: '', dirty: false, revision: 4 });
    expect(manuallyEdited).toMatchObject({ committedText: 'I would listen\ncarefully first', dirty: true });
    expect(appended).toMatchObject({
      committedText: 'I would listen\ncarefully first and checked understanding',
      interimText: '',
      dirty: true,
    });
    expect(appended).not.toBe(manuallyEdited);
  });

  it('replaces and clears presentation-only interim text without dirtying the persisted draft', () => {
    const initial = createTranscriptState(responseOne, 'I would listen first');
    const interim = reduceTranscript(initial, {
      type: 'interim', responseIdentity: responseOne, text: '  then explain options  ',
    });
    const cleared = reduceTranscript(interim, { type: 'interim', responseIdentity: responseOne, text: '' });

    expect(interim).toMatchObject({ committedText: 'I would listen first', interimText: 'then explain options', dirty: false });
    expect(cleared).toMatchObject({ committedText: 'I would listen first', interimText: '', dirty: false });
  });

  it('records an accepted checkpoint and freezes all later text mutations', () => {
    const drafted = reduceTranscript(createTranscriptState(responseOne), {
      type: 'manualReplace', responseIdentity: responseOne, text: 'I would check capacity',
    });
    const checkpointed = reduceTranscript(drafted, {
      type: 'acceptedCheckpoint', responseIdentity: responseOne, text: 'I would check capacity', revision: 1,
    });
    const frozen = reduceTranscript(checkpointed, { type: 'freeze', responseIdentity: responseOne });

    expect(checkpointed).toMatchObject({ committedText: 'I would check capacity', checkpointedText: 'I would check capacity', dirty: false, revision: 1 });
    expect(reduceTranscript(frozen, {
      type: 'finalFragment', responseIdentity: responseOne, text: 'and seek support',
    })).toBe(frozen);
    expect(reduceTranscript(frozen, {
      type: 'manualReplace', responseIdentity: responseOne, text: 'changed after deadline',
    })).toBe(frozen);
  });

  it('ignores final fragments from a stale response identity', () => {
    const current = createTranscriptState(responseOne, 'I would listen first');

    expect(reduceTranscript(current, {
      type: 'finalFragment', responseIdentity: responseTwo, text: 'stale fragment',
    })).toBe(current);
  });

  it('caps canonical text by Unicode code points rather than UTF-16 code units', () => {
    const withinLimit = '😀'.repeat(CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS);
    const state = reduceTranscript(createTranscriptState(responseOne), {
      type: 'manualReplace', responseIdentity: responseOne, text: withinLimit,
    });
    const capped = reduceTranscript(state, {
      type: 'finalFragment', responseIdentity: responseOne, text: 'x',
    });

    expect(Array.from(state.committedText)).toHaveLength(CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS);
    expect(state.committedText).toHaveLength(CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS * 2);
    expect(Array.from(capped.committedText)).toHaveLength(CANDIDATE_MMI_TRANSCRIPT_MAX_CODE_POINTS);
  });

  it('keeps a newer local edit dirty when an older checkpoint acknowledgement arrives', () => {
    const acknowledgedA = reduceTranscript(createTranscriptState(responseOne), {
      type: 'manualReplace', responseIdentity: responseOne, text: 'A',
    });
    const locallyEditedB = reduceTranscript(acknowledgedA, {
      type: 'manualReplace', responseIdentity: responseOne, text: 'B',
    });
    const acknowledgedWhileBWasDirty = reduceTranscript(locallyEditedB, {
      type: 'acceptedCheckpoint', responseIdentity: responseOne, text: 'A', revision: 1,
    });
    const staleAcknowledgement = reduceTranscript(acknowledgedWhileBWasDirty, {
      type: 'acceptedCheckpoint', responseIdentity: responseOne, text: 'A', revision: 0,
    });

    expect(acknowledgedWhileBWasDirty).toMatchObject({ committedText: 'B', checkpointedText: 'A', revision: 1, dirty: true });
    expect(staleAcknowledgement).toBe(acknowledgedWhileBWasDirty);
  });

  it('preserves manual trailing whitespace while adding one programmatic speech boundary', () => {
    const manual = reduceTranscript(createTranscriptState(responseOne), {
      type: 'manualReplace', responseIdentity: responseOne, text: 'I would listen first  ',
    });
    const appended = reduceTranscript(manual, {
      type: 'finalFragment', responseIdentity: responseOne, text: 'then explain options',
    });

    expect(appended.committedText).toBe('I would listen first   then explain options');
  });
});

describe('candidate MMI browser speech port', () => {
  it('uses the standard constructor, configures en-GB, and routes final and interim text separately', async () => {
    const instances: FakeRecognition[] = [];
    const webkitInstances: FakeRecognition[] = [];
    const finals: string[] = [];
    const interim: string[] = [];
    const statuses: string[] = [];
    const port = createBrowserSpeechPort({
      SpeechRecognition: fakeConstructor(instances),
      webkitSpeechRecognition: fakeConstructor(webkitInstances),
    });

    await port.start({
      responseIdentity: responseOne,
      onFinalFragment: value => finals.push(value),
      onInterimText: value => interim.push(value),
      onStatus: value => statuses.push(value),
    });
    const recognition = instances[0]!;
    recognition.emitResult({ isFinal: false, transcript: 'interim response' }, { isFinal: true, transcript: 'final response' });

    expect(port.getCapability()).toEqual({ supported: true, implementation: 'speech_recognition' });
    expect(recognition).toMatchObject({ lang: 'en-GB', continuous: true, interimResults: true });
    expect(recognition.start).toHaveBeenCalledOnce();
    expect(webkitInstances).toHaveLength(0);
    expect(finals).toEqual(['final response']);
    expect(interim).toEqual(['interim response']);
    expect(statuses).toEqual(['listening']);
  });

  it('uses WebKit recognition when the standard constructor is absent and never requests media when unsupported', async () => {
    const webkitInstances: FakeRecognition[] = [];
    const webkitPort = createBrowserSpeechPort({ webkitSpeechRecognition: fakeConstructor(webkitInstances) });
    const unsupportedPort = createBrowserSpeechPort({});

    await webkitPort.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: vi.fn() });
    await unsupportedPort.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: vi.fn() });

    expect(webkitInstances).toHaveLength(1);
    expect(webkitPort.getCapability()).toEqual({ supported: true, implementation: 'webkit_speech_recognition' });
    expect(unsupportedPort.getCapability()).toEqual({ supported: false, implementation: 'none' });
  });

  it('resolves successful preflight only from native onstart, stops it immediately, and retains no results', async () => {
    const instances: FakeRecognition[] = [];
    const statuses: string[] = [];
    const port = createBrowserSpeechPort({ SpeechRecognition: fakeConstructor(instances) });

    const preflight = port.preflight({ onStatus: status => statuses.push(status) });
    instances[0]!.emitResult({ isFinal: true, transcript: 'discarded preflight result' });
    expect(instances[0]!.stop).not.toHaveBeenCalled();
    instances[0]!.onstart?.();

    await expect(preflight).resolves.toBe('listening');
    expect(instances[0]!.start).toHaveBeenCalledOnce();
    expect(instances[0]!.stop).toHaveBeenCalledOnce();
    expect(statuses).toEqual(['listening']);
  });

  it('resolves unsupported and permission-denied preflight safely without retaining microphone state', async () => {
    const unsupportedStatuses: string[] = [];
    const unsupportedPort = createBrowserSpeechPort({});
    await expect(unsupportedPort.preflight({ onStatus: status => unsupportedStatuses.push(status) })).resolves.toBe('unsupported');

    const instances: FakeRecognition[] = [];
    const deniedStatuses: string[] = [];
    const port = createBrowserSpeechPort({ SpeechRecognition: fakeConstructor(instances) });
    const preflight = port.preflight({ onStatus: status => deniedStatuses.push(status) });
    instances[0]!.onerror?.({ error: 'service-not-allowed' });

    await expect(preflight).resolves.toBe('permission_denied');
    expect(unsupportedStatuses).toEqual(['unsupported']);
    expect(deniedStatuses).toEqual(['permission_denied']);
    expect(instances[0]!.stop).toHaveBeenCalledOnce();
  });

  it('restarts a fresh instance after an unexpected end only for the active response', async () => {
    const instances: FakeRecognition[] = [];
    const statuses: string[] = [];
    const port = createBrowserSpeechPort({ SpeechRecognition: fakeConstructor(instances) });

    await port.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: value => statuses.push(value) });
    instances[0]!.onend?.();

    expect(instances).toHaveLength(2);
    expect(instances[1]!.start).toHaveBeenCalledOnce();
    expect(statuses).toEqual(['listening', 'restarting', 'listening']);
  });

  it('does not restart after an explicit stop or stale callback from a replaced response', async () => {
    const instances: FakeRecognition[] = [];
    const finals: string[] = [];
    const port = createBrowserSpeechPort({ SpeechRecognition: fakeConstructor(instances) });

    await port.start({ responseIdentity: responseOne, onFinalFragment: value => finals.push(value), onInterimText: vi.fn(), onStatus: vi.fn() });
    const first = instances[0]!;
    await port.stop({ responseIdentity: responseOne });
    first.onend?.();

    await port.start({ responseIdentity: responseTwo, onFinalFragment: value => finals.push(value), onInterimText: vi.fn(), onStatus: vi.fn() });
    first.emitResult({ isFinal: true, transcript: 'stale fragment' });

    expect(first.stop).toHaveBeenCalledOnce();
    expect(instances).toHaveLength(2);
    expect(finals).toEqual([]);
  });

  it('maps fatal recognition errors to manual-fallback statuses and treats no-speech as restartable', async () => {
    const instances: FakeRecognition[] = [];
    const statuses: string[] = [];
    const port = createBrowserSpeechPort({ SpeechRecognition: fakeConstructor(instances) });

    await port.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: value => statuses.push(value) });
    instances[0]!.onerror?.({ error: 'not-allowed' });
    instances[0]!.onend?.();
    expect(statuses).toEqual(['listening', 'permission_denied']);
    expect(instances).toHaveLength(1);

    await port.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: value => statuses.push(value) });
    instances[1]!.onerror?.({ error: 'audio-capture' });
    instances[1]!.onend?.();
    expect(statuses).toContain('unavailable');
    expect(instances).toHaveLength(2);

    await port.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: value => statuses.push(value) });
    instances[2]!.onerror?.({ error: 'no-speech' });
    instances[2]!.onend?.();
    expect(instances).toHaveLength(4);
    expect(statuses).toContain('restarting');
  });

  it('does not restart after service-not-allowed or network failures', async () => {
    const instances: FakeRecognition[] = [];
    const statuses: string[] = [];
    const port = createBrowserSpeechPort({ SpeechRecognition: fakeConstructor(instances) });

    await port.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: status => statuses.push(status) });
    instances[0]!.onerror?.({ error: 'service-not-allowed' });
    instances[0]!.onend?.();
    await port.start({ responseIdentity: responseOne, onFinalFragment: vi.fn(), onInterimText: vi.fn(), onStatus: status => statuses.push(status) });
    instances[1]!.onerror?.({ error: 'network' });
    instances[1]!.onend?.();

    expect(instances).toHaveLength(2);
    expect(statuses).toEqual(['listening', 'permission_denied', 'listening', 'unavailable']);
  });

  it('invalidates callbacks before aborting the native instance', async () => {
    const instances: FakeRecognition[] = [];
    const finals: string[] = [];
    const port = createBrowserSpeechPort({ SpeechRecognition: fakeConstructor(instances) });

    await port.start({ responseIdentity: responseOne, onFinalFragment: value => finals.push(value), onInterimText: vi.fn(), onStatus: vi.fn() });
    const recognition = instances[0]!;
    await port.abort();
    recognition.emitResult({ isFinal: true, transcript: 'late text' });
    recognition.onend?.();

    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(finals).toEqual([]);
    expect(instances).toHaveLength(1);
  });
});
