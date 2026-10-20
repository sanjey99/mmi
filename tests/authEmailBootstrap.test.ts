import { describe, expect, it, vi } from 'vitest';
import { captureInitialEmailActionUrl, safeInternalPath } from '../src/features/auth/emailActionBootstrap';

describe('account link startup capture', () => {
  it.each([
    'https://app.example/auth/callback#token_hash=synthetic& type=invite',
    'https://app.example/#access_token=synthetic&refresh_token=synthetic&type=recovery',
    'https://app.example/auth/callback?error_code=otp_expired&error_description=private-detail',
    'https://app.example/?TOKEN_HASH=synthetic&type=invite',
  ])('scrubs the original link before returning its in-memory snapshot', href => {
    const replace = vi.fn();
    expect(captureInitialEmailActionUrl(href, replace)).toBe(href);
    expect(replace).toHaveBeenCalledExactlyOnceWith('/auth/callback');
  });

  it('does not change ordinary practice links', () => {
    const replace = vi.fn();
    expect(captureInitialEmailActionUrl('https://app.example/practice/mmi-station?sessionId=synthetic', replace)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('discards oversized credentials after scrubbing the URL', () => {
    const replace = vi.fn();
    expect(captureInitialEmailActionUrl(`https://app.example/#token_hash=${'x'.repeat(20_000)}`, replace)).toBe('https://app.example/auth/callback');
    expect(replace).toHaveBeenCalledExactlyOnceWith('/auth/callback');
  });

  it('fails before handing off a credential link if history cannot be cleared', () => {
    expect(() => captureInitialEmailActionUrl('https://app.example/#token_hash=synthetic', () => { throw new Error('blocked'); })).toThrow('blocked');
  });
});

describe('restored navigation stays inside the app', () => {
  it.each(['/', '/practice', '/practice/mmi-station?sessionId=synthetic', '/terms'])('preserves %s', path => {
    expect(safeInternalPath(path)).toBe(path);
  });

  it.each(['//attacker.example/path', '///attacker.example', '/\\attacker.example', '/%2fattacker.example', '/%5cattacker.example', 'https://attacker.example', 'javascript:alert(1)', '/bad%encoding', '/\nattacker.example'])('rejects %s', path => {
    expect(safeInternalPath(path)).toBe('/');
  });

  it('drops fragments when restoring an ordinary route', () => {
    expect(safeInternalPath('/practice#private')).toBe('/practice');
  });
});
