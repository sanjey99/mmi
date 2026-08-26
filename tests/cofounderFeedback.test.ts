import { describe, expect, it, vi } from 'vitest';
import {
  listCofounderFeedback,
  submitCofounderFeedback,
} from '../src/features/cofounderFeedback/api';

const feedbackId = '22222222-2222-4222-8222-222222222222';

const rpcClient = (data: unknown, error: { code?: string; message?: string } | null = null) => ({
  rpc: vi.fn().mockResolvedValue({ data, error }),
});

describe('cofounder feedback API', () => {
  it('normalizes and submits only the privacy-minimal fields', async () => {
    const client = rpcClient(feedbackId);

    await expect(submitCofounderFeedback(client, {
      category: 'usability',
      severity: 'major',
      screen: 'practice',
      message: '  The submit state was not clear after I pressed the button.  ',
      appVersion: '1.0.0',
      allowReply: true,
    })).resolves.toBe(feedbackId);

    expect(client.rpc).toHaveBeenCalledWith('submit_cofounder_feedback', {
      p_category: 'usability',
      p_severity: 'major',
      p_screen: 'practice',
      p_message: 'The submit state was not clear after I pressed the button.',
      p_app_version: '1.0.0',
      p_allow_reply: true,
    });
  });

  it('rejects invalid or oversized input before any request', async () => {
    const client = rpcClient(feedbackId);

    await expect(submitCofounderFeedback(client, {
      category: 'bug',
      severity: 'minor',
      screen: 'orientation',
      message: 'short',
      appVersion: '1.0.0',
      allowReply: false,
    })).rejects.toThrow('Feedback must be between 10 and 2000 characters.');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns validated admin review rows and accepts bounded limits only', async () => {
    const client = rpcClient([{
      id: feedbackId,
      category: 'bug',
      severity: 'blocking',
      screen: 'question_desk',
      message: 'Question creation did not confirm that the draft was saved.',
      app_version: '1.0.0',
      allow_reply: false,
      author_id: null,
      created_at: '2026-08-25T00:00:00.000Z',
    }]);

    await expect(listCofounderFeedback(client, 50)).resolves.toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledWith('list_cofounder_feedback', { p_limit: 50 });

    await expect(listCofounderFeedback(client, 201)).rejects.toThrow('Feedback request is invalid.');
  });

  it('does not expose database details or accept malformed responses', async () => {
    const failedClient = rpcClient(null, { code: 'XX000', message: 'private database detail' });
    await expect(listCofounderFeedback(failedClient)).rejects.toThrow('Feedback service is unavailable.');

    const malformedClient = rpcClient([{ id: feedbackId, message: 'incomplete' }]);
    await expect(listCofounderFeedback(malformedClient)).rejects.toThrow(
      'Feedback service returned an invalid response.',
    );
  });
});
