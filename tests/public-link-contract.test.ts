import { describe, expect, it, vi } from "vitest";

import {
  PUBLIC_LINK_ALLOWED_HOSTS,
  parseSafePublicUrl
} from "../lib/public-links/safe-public-url";

describe("public link contract", () => {
  it("publishes the exact reviewed host allowlist", () => {
    expect(PUBLIC_LINK_ALLOWED_HOSTS).toEqual([
      "docs.google.com",
      "nj-34-assembly-morales.web.fireside21.app",
      "www.essexclerk.com",
      "www.nj.gov",
      "www.njleg.state.nj.us"
    ]);
  });

  it.each([
    ["https://www.essexclerk.com/Election", "https://www.essexclerk.com/Election"],
    ["https://www.nj.gov/state/elections/index.shtml", "https://www.nj.gov/state/elections/index.shtml"],
    ["https://www.njleg.state.nj.us", "https://www.njleg.state.nj.us/"],
    ["https://docs.google.com/forms/d/e/example/viewform", "https://docs.google.com/forms/d/e/example/viewform"],
    [
      "https://nj-34-assembly-morales.web.fireside21.app/forms/writeyourrep/?to=Assemblywoman%20Carmen%20Theresa%20Morales",
      "https://nj-34-assembly-morales.web.fireside21.app/forms/writeyourrep/?to=Assemblywoman%20Carmen%20Theresa%20Morales"
    ],
    [" https://WWW.NJ.GOV:443/state/elections/../elections/vote.shtml ", "https://www.nj.gov/state/elections/vote.shtml"]
  ])("normalizes an approved absolute HTTPS URL", (input, expected) => {
    expect(parseSafePublicUrl(input)).toBe(expected);
  });

  it.each([
    "http://www.nj.gov/state/elections",
    "https://user:password@www.nj.gov/state/elections",
    "https://www.nj.gov:444/state/elections",
    "https://nj.gov/state/elections",
    "https://sub.www.nj.gov/state/elections",
    "https://example.com/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "//www.nj.gov/state/elections",
    "/state/elections",
    "not a url",
    ""
  ])("rejects an unsafe or unapproved URL: %s", (input) => {
    expect(() => parseSafePublicUrl(input)).toThrow(TypeError);
  });

  it("enforces the normalized 2,048-character boundary", () => {
    const prefix = "https://www.nj.gov/";
    const accepted = `${prefix}${"a".repeat(2_048 - prefix.length)}`;
    const rejected = `${accepted}b`;

    expect(parseSafePublicUrl(accepted)).toBe(accepted);
    expect(() => parseSafePublicUrl(rejected)).toThrow(/2,048/);
  });

  it("is a pure parser that never fetches the destination", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(parseSafePublicUrl("https://www.essexclerk.com/Services/5"))
      .toBe("https://www.essexclerk.com/Services/5");
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
