export const MMI_DIMENSIONS = Object.freeze([
  'structure',
  'ethics',
  'communication',
  'reflection',
  'nhs_awareness',
] as const);

export const MMI_IMPROVEMENT_FRAMEWORKS = Object.freeze([
  'sbar',
  'starr',
  'spar',
  'four-pillars',
] as const);

export const MMI_STUDENT_FEEDBACK_TEMPLATES = Object.freeze([
  'clear-priorities',
  'balanced-ethical-reasoning',
  'patient-centred-language',
  'reflective-learning',
  'nhs-context',
  'explicit-safety-netting',
  'weigh-ethical-pillars',
  'check-understanding',
  'deepen-reflection',
  'connect-nhs-values',
  'escalate-immediate-risk',
  'protect-confidentiality',
  'seek-senior-support',
] as const);

export type MmiDimension = (typeof MMI_DIMENSIONS)[number];
export type MmiScore = 1 | 2 | 3 | 4 | 5;
export type MmiImprovementFramework = (typeof MMI_IMPROVEMENT_FRAMEWORKS)[number];
export type MmiStudentFeedbackTemplate = (typeof MMI_STUDENT_FEEDBACK_TEMPLATES)[number];
export type MmiFeedbackKind = 'strength' | 'improvement';

export type MmiPromptIdentity =
  | { promptKind: 'standard'; stationId: string; subQuestionId: string }
  | { promptKind: 'roleplay'; stationId: string };

export interface MmiTranscriptEvidenceReference {
  start: number;
  end: number;
}

export interface MmiDimensionResult {
  score: MmiScore | null;
  applicable: boolean;
  evidence: string | null;
  improvement: string | null;
}

export interface MmiAssessment {
  dimensions: Record<MmiDimension, MmiDimensionResult>;
  overallPct: number;
  strengths: string[];
  improvements: string[];
  improvementTip: string;
  rubricVersion: number;
}

export type SubmitMmiPromptRequest = MmiPromptIdentity & {
  attemptId: string;
  transcript: string;
  idempotencyKey: string;
};

export interface MmiRubricCriterion {
  dimension: MmiDimension;
  kind: MmiFeedbackKind;
  assessorCriterion: string;
  studentFeedback: MmiStudentFeedbackTemplate;
}

export interface MmiSafetyCriticalItem {
  id: string;
  assessorCriterion: string;
  studentFeedback: MmiStudentFeedbackTemplate;
}

export interface MmiRubric {
  version: number;
  criteria: Record<string, MmiRubricCriterion>;
  dimensionWeights: Record<MmiDimension, number>;
  safetyCriticalItems: MmiSafetyCriticalItem[];
}

export interface ProviderMmiDimensionResult {
  score: MmiScore | null;
  evidenceReference: MmiTranscriptEvidenceReference | null;
}

export interface ProviderAssessment {
  dimensions: Record<MmiDimension, ProviderMmiDimensionResult>;
  rubricStrengthCodes: string[];
  rubricImprovementCodes: string[];
  safetyCriticalOmissionCodes: string[];
  improvementFramework: MmiImprovementFramework;
}
