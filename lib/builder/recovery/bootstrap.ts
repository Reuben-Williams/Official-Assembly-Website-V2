import type { RecoveryEnvironment } from "./contracts";

export interface RecoveryBootstrapHealth {
  readonly ready: boolean;
  readonly generationId: number | null;
  readonly routeCount: number;
  readonly mediaCount: number;
}
type WorkerResult =
  | { status: "idle" }
  | { status: "completed" | "stale_fence"; generationId: number }
  | { status: "retry" | "dead_letter"; generationId: number; safeCode: string };

export async function runRecoveryBootstrap(input: {
  environment: RecoveryEnvironment;
  siteKey: string;
  confirmation: string;
  runOnce: () => Promise<WorkerResult>;
  health: () => Promise<RecoveryBootstrapHealth>;
  maximumJobs?: number;
}) {
  if (input.confirmation !== `${input.siteKey}:${input.environment}`) {
    throw new Error("Exact recovery bootstrap confirmation is required.");
  }
  const maximumJobs = input.maximumJobs ?? 100;
  let jobsProcessed = 0;
  for (let index = 0; index < maximumJobs; index += 1) {
    const result = await input.runOnce();
    if (result.status === "idle") break;
    if (result.status === "dead_letter") throw new Error(`Recovery bootstrap failed: ${result.safeCode}.`);
    if (result.status === "completed") jobsProcessed += 1;
  }
  const health = await input.health();
  if (!health.ready || health.generationId === null) {
    throw new Error("Published snapshot recovery is not ready.");
  }
  return {
    environment: input.environment,
    siteKey: input.siteKey,
    generationId: health.generationId,
    routeCount: health.routeCount,
    mediaCount: health.mediaCount,
    jobsProcessed,
    status: "ready" as const
  };
}
