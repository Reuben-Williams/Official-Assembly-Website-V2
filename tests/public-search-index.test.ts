import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../lib/builder/server-content", async importOriginal => ({
  ...await importOriginal<object>(), loadBuilderServerContent: mocks.load,
}));
vi.mock("../lib/supabase/admin", () => ({ getBuilderAdminClient: () => null }));
vi.mock("../lib/calendar/server", () => ({ loadOfficialAssemblyPublicCalendar: async () => ({ status: "ready", events: [] }) }));
import { loadPublicSearchEntries } from "../lib/public-search-server";
import { searchPublicEntries } from "../lib/public-search";

describe("public search index", () => {
  beforeEach(() => mocks.load.mockResolvedValue({ regions: {} }));
  it("finds the actual homepage volunteer copy without requiring a saved override", async () => {
    const index = await loadPublicSearchEntries("en");
    expect(searchPublicEntries(index.entries, "volunteer")).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/#volunteer", section: "Assemblywoman Morales’ Community Volunteers" }),
    ]));
    expect(searchPublicEntries(index.entries, "faith-based").some(result => result.href === "/#volunteer")).toBe(true);
  });
  it("includes Spanish volunteer content", async () => {
    const index = await loadPublicSearchEntries("es");
    expect(searchPublicEntries(index.entries, "voluntario").some(result => result.href === "/#volunteer")).toBe(true);
  });
  it("indexes published rich text as readable text, not markup or image metadata", async () => {
    mocks.load.mockResolvedValue({ regions: {
      "home.official.education.details": { type: "richText", value: "<ul><li>Distinctive qualification</li></ul>" },
      "media.private": { type: "image", alt: "Do not index this metadata" },
    } });
    const index = await loadPublicSearchEntries("en");
    expect(searchPublicEntries(index.entries, "Distinctive qualification")[0]).toMatchObject({ href: "/#representative", text: "Distinctive qualification" });
    expect(searchPublicEntries(index.entries, "metadata")).toHaveLength(0);
  });
});
