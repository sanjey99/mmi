import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createEmailActionService, type EmailActionAuth } from '../src/features/auth/emailActions';

const origin = 'https://mmi-hazel.vercel.app';
const tokenHash = 'a'.repeat(64);
const templates = [
  { file: 'invite.html', mode: 'invite', paths: ['/auth/callback', '/terms', '/privacy'] },
  { file: 'recovery.html', mode: 'recovery', paths: ['/auth/callback'] },
  { file: 'confirmation.html', mode: 'signup', paths: ['/auth/callback', '/terms', '/privacy'] },
] as const;

// These tracked templates use simple Go field substitutions only. Reject any
// unsupported action so a future template change cannot bypass this renderer.
function renderTemplate(source: string, fields: Readonly<Record<string, string>>): string {
  const rendered = source.replace(/{{\s*\.([A-Za-z][A-Za-z0-9]*)\s*}}/g, (_match, name: string) => {
    if (!(name in fields)) throw new Error(`Unsupported template field: ${name}`);
    return fields[name].replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  });
  if (/{{|}}/.test(rendered)) throw new Error('Unsupported template action.');
  return rendered;
}

function linksIn(html: string): URL[] {
  return [...html.matchAll(/\bhref="([^"]+)"/g)].map((match) => new URL(match[1]
    .replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')));
}

const driftedOrigins = [
  'https://mmi-sanjey99s-projects.vercel.app/',
  'https://mmi-gpt55.vercel.app/',
  'https://attacker.example.test/redirect?next=',
  '//attacker.example.test',
  'javascript:alert("drift")',
  'https://attacker.example.test/\"><img src=x>',
  '',
];

describe.each(templates)('fixed canonical account email: $file', ({ file, mode, paths }) => {
  const source = readFileSync(resolve(process.cwd(), 'supabase/templates', file), 'utf8');

  it('allows the token hash as its only dynamic template field', () => {
    expect([...source.matchAll(/{{\s*([^}]+?)\s*}}/g)].map(match => match[1].trim())).toEqual(['.TokenHash']);
  });

  it.each(driftedOrigins)('keeps every rendered target on the main app when SiteURL is %j', (siteUrl) => {
    const rendered = renderTemplate(source, {
      TokenHash: tokenHash,
      SiteURL: siteUrl,
      RedirectTo: 'https://attacker.example.test/wrong?token=PRIVATE_REDIRECT',
      ConfirmationURL: 'https://attacker.example.test/verify?token=PRIVATE_CONFIRMATION',
      Email: 'untrusted@example.test',
      Data: 'UNTRUSTED_USER_METADATA',
    });
    const links = linksIn(rendered);
    expect(links.map(link => link.pathname)).toEqual(paths);
    for (const link of links) {
      expect(link.origin).toBe(origin);
      expect(link.username).toBe('');
      expect(link.password).toBe('');
      expect(link.search).toBe('');
      expect(`${link.origin}${link.pathname}`).not.toContain(tokenHash);
    }
    const action = links[0];
    const fragment = new URLSearchParams(action.hash.slice(1));
    expect([...fragment.keys()]).toEqual(['token_hash', 'type']);
    expect(fragment.get('token_hash')).toBe(tokenHash);
    expect(fragment.get('type')).toBe(mode);
    expect(links.slice(1).every(link => link.hash === '')).toBe(true);
    expect(rendered).not.toMatch(/attacker\.example\.test|PRIVATE_|UNTRUSTED_|untrusted@example\.test/);
  });

  it('produces a typed callback accepted by the real application without changing a password', async () => {
    const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const session = { access_token: 'synthetic-email-access', refresh_token: 'synthetic-email-refresh', user };
    const authData = { data: { user, session }, error: null };
    const client = {
      verifyOtp: vi.fn<EmailActionAuth['verifyOtp']>(async () => authData),
      getUser: vi.fn<EmailActionAuth['getUser']>(async () => ({ data: { user }, error: null })),
      getSession: vi.fn<EmailActionAuth['getSession']>(async () => ({ data: { session }, error: null })),
      setSession: vi.fn<EmailActionAuth['setSession']>(async () => authData),
      exchangeCodeForSession: vi.fn<EmailActionAuth['exchangeCodeForSession']>(async () => authData),
      resetPasswordForEmail: vi.fn<EmailActionAuth['resetPasswordForEmail']>(async () => ({ error: null })),
    } satisfies EmailActionAuth;
    const updatePassword = vi.fn(async () => ({ data: { user }, error: null }));
    const service = createEmailActionService({ auth: client, callbackOrigin: origin, updatePasswordForSession: updatePassword });
    const replaceUrl = vi.fn();
    const link = linksIn(renderTemplate(source, { TokenHash: tokenHash }))[0];

    await expect(service.handleCallback(link.href, replaceUrl)).resolves.toEqual({ mode, userId: user.id });
    expect(client.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: tokenHash, type: mode });
    expect(replaceUrl).toHaveBeenCalledExactlyOnceWith('/auth/callback');
    expect(client.setSession).not.toHaveBeenCalled();
    expect(client.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(updatePassword).not.toHaveBeenCalled();
    expect(service.peekPendingAction()).toEqual(mode === 'signup' ? null : { mode, userId: user.id });
  });
});
