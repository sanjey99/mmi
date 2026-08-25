// @ts-expect-error Node/Vitest runtime resolution requires the source extension.
import { requireLocalMutationTests } from './mutationTestSafety.ts';

export default function requireLocalMutationEnvironment(): void {
  requireLocalMutationTests(process.env);
}
