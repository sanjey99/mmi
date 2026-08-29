export const CANDIDATE_MMI_FEATURE_FLAG = 'normalized_mmi_station_enabled' as const;

export async function isNormalizedMmiStationEnabled(readConfig: (key: string) => Promise<unknown>): Promise<boolean> {
  try {
    return await readConfig(CANDIDATE_MMI_FEATURE_FLAG) === 'true';
  } catch {
    return false;
  }
}
