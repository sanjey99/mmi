import { describe, expect, it, vi } from 'vitest';
import { navigateBackOr } from '../src/lib/navigation';

describe('navigateBackOr', () => {
  it('uses browser history when a safe back entry exists', () => {
    const back = vi.fn();
    const replace = vi.fn();

    expect(navigateBackOr({ canGoBack: () => true, back, replace }, '/(tabs)')).toBe('back');
    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('replaces with the named fallback for a deep link or empty history', () => {
    const back = vi.fn();
    const replace = vi.fn();

    expect(navigateBackOr({ canGoBack: () => false, back, replace }, '/admin')).toBe('fallback');
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/admin');
  });

  it('fails safely to the named route when history inspection is unavailable', () => {
    const replace = vi.fn();

    expect(navigateBackOr({ back: vi.fn(), replace }, '/(auth)/login')).toBe('fallback');
    expect(replace).toHaveBeenCalledWith('/(auth)/login');
  });
});
