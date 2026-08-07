const confirmation = process.argv.find((argument) => argument.startsWith("--confirm="))?.slice("--confirm=".length);

try {
  const {
    createOfficialAssemblyRecoveryRuntime,
    runRecoveryBootstrap
  } = await import("../lib/builder/recovery/index.ts");
  const recovery = createOfficialAssemblyRecoveryRuntime();
  const result = await runRecoveryBootstrap({
    environment: recovery.environment,
    siteKey: recovery.siteKey,
    confirmation: confirmation ?? "",
    runOnce: recovery.runOnce,
    health: recovery.health
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write("Published snapshot recovery is not ready.\n");
  process.exitCode = 1;
}
