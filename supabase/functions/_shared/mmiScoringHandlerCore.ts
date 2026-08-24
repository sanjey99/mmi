// @ts-ignore Edge functions deliberately import source TypeScript.
import { createMmiPublicOutputContext, parseMmiRubric, toPublicMmiAssessment, type MmiAssessment } from './mmiContracts.ts';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { getRetainedMmiScoringContract, parseProviderAssessmentForContract } from './mmiScoringContract.ts';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { buildMmiScoringSystemPrompt, formatReviewedTranscript } from './mmiScoring.ts';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { runMmiScoringOrchestration } from './mmiScoringOrchestration.ts';

export interface MmiScoringHandlerSnapshot {
  hidden_reference_answer: string | null;
  hidden_actor_context: unknown;
  rubric_id: string;
  rubric_version: number;
  rubric_criteria: unknown;
  rubric_dimension_weights: unknown;
  rubric_safety_critical_items: unknown;
  scoring_contract_version: string;
  global_contract_snapshot: unknown;
  response_schema_snapshot: unknown;
}

export interface MmiScoringCompletion {
  assessment: MmiAssessment;
  attemptStatus: 'in_progress' | 'completed';
  hasNextPrompt: boolean;
}

/**
 * Production invariants live here; callers may inject only outbound provider
 * and persistence operations. This keeps deterministic tests faithful to the
 * same retained-contract parser and public mapper used in the Edge handler.
 */
export async function scoreMmiPromptCore(input: {
  transcript: string;
  snapshot: MmiScoringHandlerSnapshot;
  runProvider: (request: { systemPrompt: string; userContent: string; maxTokens: number }) => Promise<string>;
  complete: (assessment: MmiAssessment) => Promise<MmiScoringCompletion>;
  fail: (safeErrorCode: 'scoring_unavailable') => Promise<void>;
}): Promise<MmiScoringCompletion | { code: 'scoring_unavailable' }> {
  try {
    const rubric = parseMmiRubric({
      version: input.snapshot.rubric_version,
      criteria: input.snapshot.rubric_criteria,
      dimensionWeights: input.snapshot.rubric_dimension_weights,
      safetyCriticalItems: input.snapshot.rubric_safety_critical_items,
    });
    const contract = getRetainedMmiScoringContract(
      input.snapshot.global_contract_snapshot,
      input.snapshot.scoring_contract_version,
      input.snapshot.response_schema_snapshot,
    );
    return await runMmiScoringOrchestration<MmiAssessment, MmiScoringCompletion>({
      transcript: input.transcript,
      runProvider: async () => await input.runProvider({
        systemPrompt: buildMmiScoringSystemPrompt({
          rubric,
          hiddenReferenceAnswer: input.snapshot.hidden_reference_answer,
          hiddenActorContext: input.snapshot.hidden_actor_context,
          assessorInstructions: contract.assessorInstructions,
          responseSchema: input.snapshot.response_schema_snapshot,
        }),
        userContent: formatReviewedTranscript(input.transcript),
        maxTokens: 900,
      }),
      parseProvider: (raw) => {
        const parsed = parseProviderAssessmentForContract(raw, contract, rubric, input.transcript);
        return toPublicMmiAssessment(parsed, input.transcript, createMmiPublicOutputContext({
          rubric,
          scoringContractVersion: contract.version,
          studentFeedbackCatalog: contract.studentFeedbackCatalog,
        }));
      },
      complete: input.complete,
      fail: input.fail,
    });
  } catch {
    try { await input.fail('scoring_unavailable'); } catch { /* preserve safe failure */ }
    return { code: 'scoring_unavailable' };
  }
}
