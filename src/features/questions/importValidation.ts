import { validateQuestionDraft, type QuestionDraft } from './validation';

const SOURCE_NAMESPACE = /^[a-z][a-z0-9_]{2,63}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_BATCH_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface QuestionImportDraft extends QuestionDraft {
  source_namespace: string;
  source_id: string;
  source_manifest_sha256: string;
  source_batch_id: string;
}

export type QuestionImportValidationResult =
  | { success: true; data: QuestionImportDraft }
  | { success: false; issues: string[] };

const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/**
 * Validates provenance used only by the workbook batch importer. Keeping this
 * separate lets normal one-question authoring retain its smaller contract.
 */
export function validateQuestionImport(value: unknown): QuestionImportValidationResult {
  const draft = validateQuestionDraft(value);
  const input = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const sourceNamespace = stringValue(input.source_namespace);
  const sourceId = stringValue(input.source_id);
  const sourceManifestSha256 = stringValue(input.source_manifest_sha256);
  const sourceBatchId = stringValue(input.source_batch_id);
  const issues: string[] = draft.success ? [] : [...draft.issues];

  if (!SOURCE_NAMESPACE.test(sourceNamespace)) {
    issues.push('Source namespace must use lowercase letters, digits, and underscores.');
  }
  if (!SOURCE_ID.test(sourceId)) {
    issues.push('Source ID is required and may contain only letters, digits, underscores, periods, slashes, colons, and hyphens.');
  }
  if (!SHA256.test(sourceManifestSha256)) {
    issues.push('Source manifest must be a lowercase SHA-256 value.');
  }
  if (!SOURCE_BATCH_ID.test(sourceBatchId)) {
    issues.push('Source batch ID must use lowercase letters, digits, underscores, and hyphens.');
  }
  if (input.is_active === true) {
    issues.push('Imported questions must be inactive.');
  }
  if (issues.length > 0 || !draft.success) return { success: false, issues };

  return {
    success: true,
    data: {
      ...draft.data,
      source_namespace: sourceNamespace,
      source_id: sourceId,
      source_manifest_sha256: sourceManifestSha256,
      source_batch_id: sourceBatchId,
    },
  };
}
