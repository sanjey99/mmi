import type { CandidateMmiMediaPort } from './types';

const noCaptureMediaPort: CandidateMmiMediaPort = Object.freeze({
  async prepare(): Promise<void> {},
  async beginResponse(): Promise<void> {},
  async finishResponse() {
    return null;
  },
  async abort(): Promise<void> {},
});

export function createNoCaptureMediaPort(): CandidateMmiMediaPort {
  return noCaptureMediaPort;
}
