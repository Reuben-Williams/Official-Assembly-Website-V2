import { describe, expect, it } from "vitest";

import builderConfig from "../builder.config";
import { officialLegislatureProfile } from "../app/data/official-legislature-profile";

describe("reviewed official Legislature profile snapshot", () => {
  it("records the verified source, protected facts, and canonical actions", () => {
    expect(officialLegislatureProfile.provenance).toEqual({
      sourceUrl: "https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales",
      apiUrl: "https://www.njleg.state.nj.us/api/legislatorData/legislatorBio/491",
      checkedAt: "2026-08-08",
    });
    expect(officialLegislatureProfile.identity).toMatchObject({
      name: "Carmen Theresa Morales",
      title: "Assemblywoman",
      party: "D",
      position: "Deputy Whip",
      district: "34",
    });
    expect(officialLegislatureProfile.office).toEqual({
      address: "152 Franklin Street, Belleville, NJ 07109",
      phoneDisplay: "(973) 450-0484",
      phoneHref: "tel:+19734500484",
      fax: "(973) 450-0487",
    });
    expect(officialLegislatureProfile.actions).toEqual({
      profile: officialLegislatureProfile.provenance.sourceUrl,
      sponsoredBills: officialLegislatureProfile.provenance.sourceUrl,
      votesByBill: "https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales/votes-by-bill",
      votesBySubject: "https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales/votes-by-subject",
      legislativeContact: "https://nj-34-assembly-morales.web.fireside21.app/forms/writeyourrep/?to=Assemblywoman%20Carmen%20Theresa%20Morales",
    });
  });

  it("contains only the approved education, service, occupation, and committee facts", () => {
    expect(officialLegislatureProfile.education).toEqual([
      "B.A. Montclair State University (Speech Communications)",
      "M.A.S. Fairleigh Dickinson University (Administration)",
      "Ed.S., Completed Doctoral Studies ABD Seton Hall University (Education, Leadership, Management and Policy)",
    ]);
    expect(officialLegislatureProfile.occupation).toBe(
      "Director of Curriculum and Instruction, Essex County Schools of Technology",
    );
    expect(officialLegislatureProfile.publicService).toEqual([
      "Essex County College Trustee 2017-2023",
    ]);
    expect(officialLegislatureProfile.legislativeService).toEqual([
      "General Assembly 2024-present, Deputy Majority Whip 2026-present",
    ]);
    expect(officialLegislatureProfile.committees).toEqual([
      { code: "AHI", name: "Higher Education", position: "Chair" },
      { code: "AAP", name: "Appropriations", position: null },
      { code: "AST", name: "Science, Innovation and Technology", position: null },
      { code: "JPS", name: "Joint Committee on the Public Schools", position: null },
    ]);
  });

  it("keeps official facts and destinations out of ordinary editable regions", () => {
    const home = builderConfig.pages.find((page) => page.path === "/");
    const regionIds = new Set([
      ...builderConfig.globalRegions.map((region) => region.id),
      ...(home?.regions ?? []).map((region) => region.id),
    ]);

    for (const framingRegion of [
      "home.official.eyebrow",
      "home.official.title",
      "home.official.body",
    ]) {
      expect(regionIds.has(framingRegion)).toBe(true);
    }
    for (const protectedField of officialLegislatureProfile.protectedFields) {
      expect(regionIds.has(protectedField)).toBe(false);
    }
  });
});
