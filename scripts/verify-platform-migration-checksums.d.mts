export const EXPECTED_PLATFORM_MIGRATIONS: readonly (readonly [string, string])[];

export function verifyPlatformMigrationChecksums(repositoryRoot: string): Promise<{
  checked: number;
  valid: true;
}>;
