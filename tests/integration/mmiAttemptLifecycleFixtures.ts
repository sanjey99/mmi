import type { SupabaseClient } from '@supabase/supabase-js';

type FixtureEnvironment = Readonly<Record<string, string | undefined>>;

export function shouldPreserveMmiAttemptLifecycleFixtures(environment: FixtureEnvironment = process.env) {
  return environment.MMI_ATTEMPT_LIFECYCLE_ALLOW_DESTRUCTIVE_CLEANUP !== 'DELETE_LOCAL_FIXTURES';
}

export async function teardownMmiAttemptLifecycleFixtures(
  service: SupabaseClient,
  ownerId: string,
  otherId: string,
  fixturePrefix: string,
  environment: FixtureEnvironment = process.env,
) {
  if (shouldPreserveMmiAttemptLifecycleFixtures(environment)) return;
  await service.from('mmi_attempts').delete().in('user_id', [ownerId, otherId]);
  await service.from('mmi_scoring_rubrics').delete().or(`standard_sub_q_id.like.${fixturePrefix}%,roleplay_station_id.like.${fixturePrefix}%`);
  await service.from('mmi_privacy_notices').delete().like('version', `${fixturePrefix}%`);
  await service.from('roleplay_stations').delete().like('station_id', `${fixturePrefix}%`);
  await service.from('mmi_stations').delete().like('station_id', `${fixturePrefix}%`);
  await service.auth.admin.deleteUser(ownerId);
  await service.auth.admin.deleteUser(otherId);
}
