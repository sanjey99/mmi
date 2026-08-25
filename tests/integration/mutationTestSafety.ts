const LOCAL_MUTATION_OPT_IN = 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

type MutationTestEnvironment = Record<string, string | undefined>;

export function canRunLocalMutationTests(environment: MutationTestEnvironment): boolean {
  const {
    SUPABASE_LOCAL_MUTATION_TESTS: optIn,
    SUPABASE_TEST_ANON_KEY: anonKey,
    SUPABASE_TEST_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_TEST_URL: url,
  } = environment;
  if (optIn !== LOCAL_MUTATION_OPT_IN || !url || !anonKey || !serviceRoleKey) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function requireLocalMutationTests(environment: MutationTestEnvironment): void {
  if (!canRunLocalMutationTests(environment)) {
    throw new Error(
      'Local mutation integration prerequisites are missing or unsafe. Use an HTTP loopback Supabase URL, local test credentials, and the explicit mutation opt-in.',
    );
  }
}
