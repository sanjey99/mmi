import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('final release UI policy', () => {
  it('provides substantive reachable Terms and Privacy documents', () => {
    const terms = read('app/terms.tsx');
    const privacy = read('app/privacy.tsx');
    const legalFooter = read('src/components/legal/LegalFooter.tsx');

    expect(terms).toContain('Closed-preview terms');
    expect(terms).toContain('Medical and admissions disclaimer');
    expect(terms).toContain('Acceptable use');
    expect(privacy).toContain('Information we collect');
    expect(privacy).toContain('Service providers and AI processing');
    expect(privacy).toContain('Retention and your choices');
    expect(legalFooter).toContain("router.push('/terms')");
    expect(legalFooter).toContain("router.push('/privacy')");
    expect(read('app/(auth)/login.tsx')).toContain('<LegalFooter />');
    expect(read('app/profile.tsx')).toContain('<LegalFooter />');
  });

  it('removes visible shadow elevation from the shared UI system', () => {
    const card = read('src/components/ui/Card.tsx');
    const statCard = read('src/components/ui/StatCard.tsx');
    const spacing = read('src/theme/spacing.ts');

    expect(`${card}\n${statCard}\n${spacing}`).not.toMatch(
      /shadowColor|shadowOffset|shadowOpacity|shadowRadius|boxShadow|elevation\s*:/,
    );
  });

  it('uses corridor top rules instead of stock colored-left callout strips', () => {
    expect(read('app/(tabs)/progress.tsx')).not.toMatch(/borderLeft(Color|Width)/);
    expect(read('app/cofounder-feedback.tsx')).not.toMatch(/borderLeft(Color|Width)/);
    expect(read('src/components/ui/StatCard.tsx')).not.toMatch(/borderLeft(Color|Width)/);
  });

  it('keeps the closed preview invitation-only at the legacy signup route', () => {
    const signup = read('app/(auth)/signup.tsx');
    const authStore = read('src/stores/authStore.ts');

    expect(signup).toContain('Accounts are issued by invitation');
    expect(signup).toContain('Return to sign in');
    expect(signup).not.toMatch(/auth\.signUp\s*\(/);
    expect(authStore).not.toMatch(/\bsignUp\s*:/);
  });

  it('keeps the synthetic browser suite on a local intercepted deployment', () => {
    const playwrightConfig = read('playwright.config.ts');
    const browserSuite = read('e2e/cofounder-preview.spec.ts');

    expect(playwrightConfig).toContain('E2E_BASE_URL must target localhost');
    expect(playwrightConfig).toContain("['localhost', '127.0.0.1', '::1']");
    expect(browserSuite).toContain("'https://*.supabase.co/**'");
    expect(browserSuite).toContain('Unexpected Supabase host');
  });

  it('uses the canonical public practice URL for every feedback exit', () => {
    const feedback = read('app/practice/feedback.tsx');

    expect(feedback.match(/router\.replace\('\/practice'\)/g)).toHaveLength(3);
    expect(feedback).not.toContain("router.dismissTo('/practice')");
    expect(feedback).not.toContain('<Redirect href="/practice" />');
    expect(feedback).not.toContain("router.replace('/(tabs)/practice')");
  });

  it('renders a privacy-minimal unavailable state instead of auto-navigating', () => {
    const feedback = read('app/practice/feedback.tsx');

    expect(feedback).toContain('Feedback unavailable');
    expect(feedback).toContain('This review cannot be opened from the current account or browser session.');
    expect(feedback).not.toMatch(/belongs to another|different user|session exists/i);
  });

  it('waits for restored authentication before deciding feedback ownership', () => {
    const feedback = read('app/practice/feedback.tsx');

    expect(feedback).toContain('const authLoading = useAuthStore(state => state.loading)');
    expect(feedback).toContain(
      'if (authLoading || !hasOwnedCachedSession || !scoreResult || !currentQuestion) return;',
    );
    expect(feedback).toContain('if (authLoading) return null;');
  });

  it('declares the configured Expo Babel preset as a direct build dependency', () => {
    const babelConfig = read('babel.config.js');
    const packageJson = JSON.parse(read('package.json')) as {
      devDependencies?: Record<string, string>;
    };

    expect(babelConfig).toContain("'babel-preset-expo'");
    expect(packageJson.devDependencies?.['babel-preset-expo']).toBe('~55.0.24');
  });
});
