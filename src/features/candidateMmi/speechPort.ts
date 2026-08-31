import type {
  CandidateMmiSpeechCallbacks,
  CandidateMmiSpeechCapability,
  CandidateMmiSpeechPort,
  CandidateMmiSpeechRecognitionConstructor,
  CandidateMmiSpeechRecognitionEvent,
  CandidateMmiSpeechRecognitionInstance,
  CandidateMmiSpeechStatus,
} from './types';

type SpeechConstructors = Readonly<{
  SpeechRecognition?: CandidateMmiSpeechRecognitionConstructor;
  webkitSpeechRecognition?: CandidateMmiSpeechRecognitionConstructor;
}>;

type ActiveResponse = Readonly<{
  generation: number;
  responseIdentity: string;
  callbacks: CandidateMmiSpeechCallbacks;
  recognition: CandidateMmiSpeechRecognitionInstance;
  restartable: boolean;
}>;

type SpeechStartInput = Readonly<{ responseIdentity: string }> & CandidateMmiSpeechCallbacks;

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function recognitionErrorStatus(error: string): Readonly<{ status: CandidateMmiSpeechStatus; restartable: boolean }> {
  if (error === 'not-allowed' || error === 'service-not-allowed') return { status: 'permission_denied', restartable: false };
  if (error === 'audio-capture' || error === 'network') return { status: 'unavailable', restartable: false };
  if (error === 'no-speech') return { status: 'restarting', restartable: true };
  return { status: 'unavailable', restartable: false };
}

function decodeResults(event: CandidateMmiSpeechRecognitionEvent): Readonly<{ finals: readonly string[]; interim: string }> {
  const finals: string[] = [];
  const interim: string[] = [];
  for (let index = Math.max(0, event.resultIndex); index < event.results.length; index += 1) {
    const result = event.results[index];
    const text = result?.[0] ? normalizeText(result[0].transcript) : '';
    if (!text) continue;
    if (result.isFinal) finals.push(text); else interim.push(text);
  }
  return Object.freeze({ finals, interim: normalizeText(interim.join(' ')) });
}

function stopRecognition(recognition: CandidateMmiSpeechRecognitionInstance, abort: boolean): void {
  if (abort && recognition.abort) recognition.abort(); else recognition.stop();
}

export function createBrowserSpeechPort(constructors: SpeechConstructors): CandidateMmiSpeechPort {
  const selectedRecognition = constructors.SpeechRecognition
    ? { constructor: constructors.SpeechRecognition, implementation: 'speech_recognition' as const }
    : constructors.webkitSpeechRecognition
      ? { constructor: constructors.webkitSpeechRecognition, implementation: 'webkit_speech_recognition' as const }
      : null;
  const Recognition = selectedRecognition?.constructor;
  const capability: CandidateMmiSpeechCapability = Object.freeze(selectedRecognition
    ? { supported: true, implementation: selectedRecognition.implementation }
    : { supported: false, implementation: 'none' });
  let generation = 0;
  let activeResponse: ActiveResponse | null = null;
  let preflight: Readonly<{ generation: number; recognition: CandidateMmiSpeechRecognitionInstance }> | null = null;

  function isCurrent(active: ActiveResponse): boolean {
    return activeResponse?.generation === active.generation && activeResponse.responseIdentity === active.responseIdentity;
  }

  function createRecognition(): CandidateMmiSpeechRecognitionInstance | null {
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;
    return recognition;
  }

  function launch(input: SpeechStartInput): void {
    const recognition = createRecognition();
    if (!recognition) {
      input.onStatus('unsupported');
      return;
    }
    const current: ActiveResponse = { generation: ++generation, responseIdentity: input.responseIdentity, callbacks: input, recognition, restartable: true };
    activeResponse = current;
    recognition.onresult = event => {
      if (!isCurrent(current)) return;
      const decoded = decodeResults(event);
      decoded.finals.forEach(input.onFinalFragment);
      input.onInterimText(decoded.interim);
    };
    recognition.onerror = event => {
      if (!isCurrent(current)) return;
      const mapped = recognitionErrorStatus(event.error);
      activeResponse = Object.freeze({ ...current, restartable: mapped.restartable });
      input.onStatus(mapped.status);
    };
    recognition.onend = () => {
      if (!isCurrent(current) || activeResponse?.restartable !== true) return;
      input.onStatus('restarting');
      launch(input);
    };
    try {
      recognition.start();
      input.onStatus('listening');
    } catch {
      if (isCurrent(current)) {
        activeResponse = null;
        generation += 1;
        input.onStatus('unavailable');
      }
    }
  }

  return Object.freeze({
    getCapability: (): CandidateMmiSpeechCapability => capability,
    start: async (input: SpeechStartInput) => {
      if (activeResponse) {
        generation += 1;
        stopRecognition(activeResponse.recognition, true);
        activeResponse = null;
      }
      launch(input);
    },
    stop: async (input: Readonly<{ responseIdentity: string }>) => {
      if (!activeResponse || activeResponse.responseIdentity !== input.responseIdentity) return;
      const recognition = activeResponse.recognition;
      generation += 1;
      activeResponse = null;
      stopRecognition(recognition, false);
    },
    preflight: async ({ onStatus }: Readonly<{ onStatus: (status: CandidateMmiSpeechStatus) => void }>) => {
      if (!Recognition) {
        onStatus('unsupported');
        return 'unsupported';
      }
      const recognition = createRecognition()!;
      const current = { generation: ++generation, recognition };
      preflight = current;
      return new Promise<CandidateMmiSpeechStatus>(resolve => {
        const settle = (status: CandidateMmiSpeechStatus) => {
          if (preflight?.generation !== current.generation) return;
          generation += 1;
          preflight = null;
          stopRecognition(recognition, false);
          onStatus(status);
          resolve(status);
        };
        recognition.onstart = () => settle('listening');
        recognition.onerror = event => settle(recognitionErrorStatus(event.error).status);
        try { recognition.start(); } catch { settle('unavailable'); }
      });
    },
    abort: async () => {
      const responseRecognition = activeResponse?.recognition;
      const preflightRecognition = preflight?.recognition;
      generation += 1;
      activeResponse = null;
      preflight = null;
      if (responseRecognition) stopRecognition(responseRecognition, true);
      if (preflightRecognition && preflightRecognition !== responseRecognition) stopRecognition(preflightRecognition, true);
    },
  });
}
