import { describe, expect, it, vi } from "vitest";

import type { CalendarRepository } from "../lib/calendar/repository";
import { loadOfficialAssemblyPublicCalendar } from "../lib/calendar/server";

function repository(readPublic: CalendarRepository["readPublic"]): CalendarRepository {
  return {
    readPublic,
    listManagement: vi.fn(),
    executeCommand: vi.fn(),
  };
}

describe("public calendar server loader", () => {
  it("performs a fresh authoritative read for every request", async () => {
    const readPublic = vi.fn(async () => []);
    const calendarRepository = repository(readPublic);

    await loadOfficialAssemblyPublicCalendar(
      { limit: 3, evaluatedAt: "2026-09-01T12:00:00.000Z" },
      { client: null, repository: calendarRepository },
    );
    await loadOfficialAssemblyPublicCalendar(
      { limit: 3, evaluatedAt: "2026-09-01T12:01:00.000Z" },
      { client: null, repository: calendarRepository },
    );

    expect(readPublic).toHaveBeenCalledTimes(2);
    expect(readPublic).toHaveBeenNthCalledWith(1, {
      siteKey: "official-assembly-website-v2",
      evaluatedAt: "2026-09-01T12:00:00.000Z",
      limit: 3,
    });
  });

  it("reports unavailable instead of presenting a failed read as an empty calendar", async () => {
    const calendarRepository = repository(vi.fn(async () => {
      throw new Error("database offline");
    }));

    await expect(loadOfficialAssemblyPublicCalendar(
      { limit: 100, evaluatedAt: "2026-09-01T12:00:00.000Z" },
      { client: null, repository: calendarRepository },
    )).resolves.toEqual({ status: "unavailable" });
  });
});
