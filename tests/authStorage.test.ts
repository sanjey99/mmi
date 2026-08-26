import { describe, expect, it, vi } from 'vitest';
import { createSessionStorageAdapter } from '../src/lib/authStorageCore';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

describe('createSessionStorageAdapter', () => {
  it('stores auth values only in the provided browser-session storage', () => {
    const storage = memoryStorage();
    const adapter = createSessionStorageAdapter(() => storage);

    adapter.setItem('supabase.auth.token', 'session-value');

    expect(adapter.getItem('supabase.auth.token')).toBe('session-value');
    adapter.removeItem('supabase.auth.token');
    expect(adapter.getItem('supabase.auth.token')).toBeNull();
  });

  it('is safe during static export when sessionStorage does not exist', () => {
    const adapter = createSessionStorageAdapter(() => undefined);

    expect(adapter.getItem('missing')).toBeNull();
    expect(() => adapter.setItem('key', 'value')).not.toThrow();
    expect(() => adapter.removeItem('key')).not.toThrow();
  });

  it('fails closed without logging credentials when browser storage throws', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
      removeItem: vi.fn(() => { throw new Error('blocked'); }),
    };
    const adapter = createSessionStorageAdapter(() => storage);

    expect(adapter.getItem('token')).toBeNull();
    expect(() => adapter.setItem('token', 'secret')).not.toThrow();
    expect(() => adapter.removeItem('token')).not.toThrow();
  });
});
