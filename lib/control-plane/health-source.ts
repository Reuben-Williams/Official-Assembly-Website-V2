import "server-only";

import type { SiteHealthSource } from "@reuben-williams/next/control-plane";
import type { SupabaseClient } from "@supabase/supabase-js";

function countValue(value: number | null) {
  if (value === null || !Number.isSafeInteger(value) || value < 0) throw new Error("Health count unavailable");
  return value;
}

export function createOfficialAssemblyHealthSource(
  client: SupabaseClient,
  siteId: string,
  now: () => Date = () => new Date()
): SiteHealthSource {
  return {
    async probeDurableStore() {
      const { error } = await client
        .from("builder_command_receipts")
        .select("site_id", { count: "exact", head: true })
        .eq("site_id", siteId);
      return error === null;
    },
    async readQueues() {
      const active = client
        .from("builder_outbox")
        .select("site_id", { count: "exact", head: true })
        .eq("site_id", siteId)
        .in("status", ["pending", "claimed"]);
      const dead = client
        .from("builder_outbox")
        .select("site_id", { count: "exact", head: true })
        .eq("site_id", siteId)
        .in("status", ["dead_letter", "reconciliation_required"]);
      const oldest = client
        .from("builder_outbox")
        .select("created_at")
        .eq("site_id", siteId)
        .in("status", ["pending", "claimed"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const [activeResult, deadResult, oldestResult] = await Promise.all([active, dead, oldest]);
      if (activeResult.error || deadResult.error || oldestResult.error) throw new Error("Queue health unavailable");
      const createdAt = oldestResult.data?.created_at ? Date.parse(String(oldestResult.data.created_at)) : null;
      const oldestAgeSeconds = createdAt === null
        ? null
        : Math.max(0, Math.floor((now().getTime() - createdAt) / 1_000));
      return {
        "builder.outbox": {
          depth: countValue(activeResult.count),
          deadLetters: countValue(deadResult.count),
          oldestAgeSeconds
        }
      };
    },
    async probeIntegrations() {
      return {
        email: "disconnected",
        sms: "disconnected",
        ai: "disconnected"
      };
    }
  };
}
