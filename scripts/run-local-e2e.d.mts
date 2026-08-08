export type LocalSupabaseEnvironment = Readonly<Record<string, string>> & Readonly<{
  API_URL: string;
  DB_URL: string;
  PUBLISHABLE_KEY: string;
  SERVICE_ROLE_KEY: string;
}>;

export function parseSupabaseEnvironment(output: string): Record<string, string>;
export function assertLocalSupabaseEnvironment(
  environment: LocalSupabaseEnvironment,
): void;
