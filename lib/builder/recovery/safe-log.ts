export function safeRecoveryLogEvent(value: Record<string, unknown>) {
  const event = typeof value.event === "string" ? value.event.slice(0, 100) : "recovery.event";
  const status = typeof value.status === "string" ? value.status.slice(0, 50) : "unknown";
  const safeCode = typeof value.safeCode === "string" ? value.safeCode.slice(0, 100) : undefined;
  const generationId = Number.isSafeInteger(value.generationId) && Number(value.generationId) > 0
    ? Number(value.generationId)
    : undefined;
  return {
    event,
    status,
    ...(generationId ? { generationId } : {}),
    ...(safeCode ? { safeCode } : {})
  };
}
