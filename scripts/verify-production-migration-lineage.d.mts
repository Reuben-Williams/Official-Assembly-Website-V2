export const EXPECTED_PRODUCTION_BASELINE: readonly (readonly [string, string])[];
export const EXPECTED_PENDING_MIGRATIONS: readonly (readonly [string, string])[];

export function verifyProductionMigrationLineage(repositoryRoot: string): Promise<{
  baseline: number;
  pending: number;
  valid: true;
}>;
