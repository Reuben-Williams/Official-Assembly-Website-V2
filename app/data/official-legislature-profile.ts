export type OfficialLegislatureProfileSnapshot = Readonly<{
  provenance: Readonly<{
    sourceUrl: string;
    apiUrl: string;
    checkedAt: string;
  }>;
  identity: Readonly<{
    name: string;
    title: string;
    party: string;
    position: string;
    district: string;
  }>;
  office: Readonly<{
    address: string;
    phoneDisplay: string;
    phoneHref: string;
    fax: string;
  }>;
  education: readonly string[];
  occupation: string;
  publicService: readonly string[];
  legislativeService: readonly string[];
  committees: readonly Readonly<{
    code: string;
    name: string;
    position: string | null;
  }>[];
  actions: Readonly<{
    profile: string;
    sponsoredBills: string;
    votesByBill: string;
    votesBySubject: string;
    legislativeContact: string;
  }>;
  protectedFields: readonly string[];
}>;

const sourceUrl = "https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales";

export const officialLegislatureProfile = Object.freeze({
  provenance: Object.freeze({
    sourceUrl,
    apiUrl: "https://www.njleg.state.nj.us/api/legislatorData/legislatorBio/491",
    checkedAt: "2026-08-08",
  }),
  identity: Object.freeze({
    name: "Carmen Theresa Morales",
    title: "Assemblywoman",
    party: "D",
    position: "Deputy Whip",
    district: "34",
  }),
  office: Object.freeze({
    address: "152 Franklin Street, Belleville, NJ 07109",
    phoneDisplay: "(973) 450-0484",
    phoneHref: "tel:+19734500484",
    fax: "(973) 450-0487",
  }),
  // The user-approved September 2026 Morales Meeting Action Sheet overrides
  // the external roster presentation for these education/biography fields.
  education: Object.freeze([
    "B.A. Montclair State University (Speech Communications)",
    "M.A.S. Fairleigh Dickinson University (Administration)",
    "EDS / EDD",
  ]),
  occupation: "Director of Curriculum and Instruction, Essex County Schools of Technology",
  publicService: Object.freeze([
    "Essex County College Trustee 2017-2023",
  ]),
  legislativeService: Object.freeze([
    "General Assembly 2024-present, Deputy Majority Whip 2026-present",
  ]),
  committees: Object.freeze([
    Object.freeze({ code: "AHI", name: "Higher Education", position: "Chair" }),
    Object.freeze({ code: "AAP", name: "Appropriations", position: null }),
    Object.freeze({ code: "AST", name: "Science, Innovation and Technology", position: null }),
    Object.freeze({ code: "JPS", name: "Joint Committee on the Public Schools", position: null }),
  ]),
  actions: Object.freeze({
    profile: sourceUrl,
    sponsoredBills: sourceUrl,
    votesByBill: `${sourceUrl}/votes-by-bill`,
    votesBySubject: `${sourceUrl}/votes-by-subject`,
    legislativeContact: "https://nj-34-assembly-morales.web.fireside21.app/forms/writeyourrep/?to=Assemblywoman%20Carmen%20Theresa%20Morales",
  }),
  protectedFields: Object.freeze([
    "official.provenance",
    "official.identity",
    "official.office",
    "official.biography",
    "official.committees",
    "official.actions",
  ]),
}) satisfies OfficialLegislatureProfileSnapshot;
