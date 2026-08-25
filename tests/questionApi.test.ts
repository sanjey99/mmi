import { describe, expect, it, vi } from 'vitest';
import {
  createQuestionRows,
  fetchQuestionById,
  fetchQuestionCatalog,
  fetchQuestionCounts,
  importQuestionRows,
} from '../src/features/questions/api';

const questionRow = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'ethics',
  subcategory: 'autonomy',
  text: 'How would you balance autonomy, communication, and patient safety?',
  university_tags: ['oxford'],
  difficulty: 'intermediate',
  is_mmi_suitable: true,
  times_attempted: 0,
  avg_score: 0,
  created_at: '2026-08-25T00:00:00.000Z',
};

const rpcClient = (data: unknown, error: { code?: string; message?: string } | null = null) => ({
  rpc: vi.fn().mockResolvedValue({ data, error }),
});

describe('legacy question RPC client', () => {
  it('requests a bounded active catalog and maps only student-safe fields', async () => {
    const client = rpcClient([{ ...questionRow, guidance_notes: 'must never cross the boundary' }]);

    await expect(fetchQuestionCatalog(client, {
      category: 'ethics',
      difficulty: 'intermediate',
      university: ' Oxford ',
      limit: 25,
    })).resolves.toEqual([{ ...questionRow, guidance_notes: null }]);

    expect(client.rpc).toHaveBeenCalledWith('list_legacy_questions', {
      p_category: 'ethics',
      p_difficulty: 'intermediate',
      p_university: 'oxford',
      p_limit: 25,
    });
  });

  it('fetches one active question by UUID and treats an empty result as unavailable', async () => {
    const client = rpcClient([]);

    await expect(fetchQuestionById(
      client,
      '11111111-1111-4111-8111-111111111111',
    )).resolves.toBeNull();
    expect(client.rpc).toHaveBeenCalledWith('get_legacy_question', {
      p_question_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('returns all category counts with truthful zero defaults', async () => {
    const client = rpcClient([
      { category: 'ethics', question_count: 2 },
      { category: 'motivation', question_count: 1 },
    ]);

    await expect(fetchQuestionCounts(client)).resolves.toEqual({
      motivation: 1,
      ethics: 2,
      nhs: 0,
      teamwork: 0,
      resilience: 0,
      scenarios: 0,
    });
    expect(client.rpc).toHaveBeenCalledWith('get_legacy_question_counts');
  });

  it('sends an exact bounded admin payload and returns the created IDs', async () => {
    const client = rpcClient([{ source_index: 0, id: questionRow.id }]);
    const draft = {
      category: 'ethics' as const,
      text: questionRow.text,
      difficulty: 'intermediate' as const,
      subcategory: 'autonomy',
      university_tags: ['oxford'],
      is_mmi_suitable: true,
      guidance_notes: 'Assess balanced reasoning.',
      is_active: false,
    };

    await expect(createQuestionRows(client, [draft])).resolves.toEqual([questionRow.id]);
    expect(client.rpc).toHaveBeenCalledWith('create_legacy_questions', { p_rows: [draft] });
  });

  it('sends workbook imports through the idempotent RPC and returns server outcomes', async () => {
    const client = rpcClient([{ source_index: 0, id: questionRow.id, outcome: 'inserted' }]);
    const draft = {
      category: 'ethics' as const,
      text: questionRow.text,
      difficulty: 'intermediate' as const,
      subcategory: 'autonomy',
      university_tags: ['oxford'],
      is_mmi_suitable: true,
      guidance_notes: 'Timing only.',
      is_active: false,
      source_namespace: 'med_interview_question_bank',
      source_id: 'MMI_001/MMI_001_Q1',
      source_manifest_sha256: '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
      source_batch_id: 'questions-part-1',
    };

    await expect(importQuestionRows(client, [draft])).resolves.toEqual({
      inserted: 1,
      updated: 0,
      unchanged: 0,
      retried: false,
      ids: [questionRow.id],
    });
    expect(client.rpc).toHaveBeenCalledWith('import_legacy_question_batch', {
      p_source_namespace: 'med_interview_question_bank',
      p_source_manifest_sha256: '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
      p_batch_id: 'questions-part-1',
      p_rows: [{
        category: 'ethics',
        text: questionRow.text,
        difficulty: 'intermediate',
        subcategory: 'autonomy',
        university_tags: ['oxford'],
        is_mmi_suitable: true,
        guidance_notes: 'Timing only.',
        is_active: false,
        source_id: 'MMI_001/MMI_001_Q1',
      }],
    });
  });

  it('rejects mixed import identities and malformed idempotency responses locally', async () => {
    const client = rpcClient([{ source_index: 0, id: questionRow.id, outcome: 'surprise' }]);
    const base = {
      category: 'ethics' as const,
      text: questionRow.text,
      difficulty: 'intermediate' as const,
      subcategory: 'autonomy',
      university_tags: ['oxford'],
      is_mmi_suitable: true,
      guidance_notes: null,
      is_active: false,
      source_namespace: 'med_interview_question_bank',
      source_manifest_sha256: '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
      source_batch_id: 'questions-part-1',
    };

    await expect(importQuestionRows(client, [
      { ...base, source_id: 'MMI_001/MMI_001_Q1' },
      { ...base, source_id: 'MMI_001/MMI_001_Q2', source_batch_id: 'questions-part-2' },
    ])).rejects.toThrow('Question request is invalid.');
    expect(client.rpc).not.toHaveBeenCalled();

    await expect(importQuestionRows(client, [{ ...base, source_id: 'MMI_001/MMI_001_Q1' }])).rejects.toThrow(
      'Question service returned an invalid response.',
    );
  });

  it('rejects malformed inputs and server responses without exposing provider errors', async () => {
    const invalidInputClient = rpcClient([]);
    await expect(fetchQuestionCatalog(invalidInputClient, { limit: 101 })).rejects.toThrow(
      'Question request is invalid.',
    );
    expect(invalidInputClient.rpc).not.toHaveBeenCalled();

    await expect(fetchQuestionById(invalidInputClient, 'not-a-uuid')).rejects.toThrow(
      'Question request is invalid.',
    );

    const invalidResponseClient = rpcClient([{ ...questionRow, category: 'secret' }]);
    await expect(fetchQuestionCatalog(invalidResponseClient)).rejects.toThrow(
      'Question service returned an invalid response.',
    );

    const failedClient = rpcClient(null, { code: 'XX000', message: 'private database detail' });
    await expect(fetchQuestionCounts(failedClient)).rejects.toThrow('Question service is unavailable.');
  });
});
