// The reviewed official record remains the default; staff changes use ordinary
// versioned content, including draft previews, publishing, and restoration.
export const officialProfileRegions = [
  ...["office", "biography", "education", "committees"].flatMap(card => [
    { id: `home.official.${card}.heading`, kind: "text" as const, label: `${card} — heading` },
    { id: `home.official.${card}.details`, kind: "richText" as const, label: `${card} — formatted details` },
  ]),
  ...["contact", "biography", "education", "sponsored", "votes-bill", "votes-subject"].map(action => ({
    id: `home.official.actions.${action}`, kind: "link" as const, label: `Representative — ${action} link`,
  })),
  ...["name", "role", "position"].map(field => ({ id: `home.official.identity.${field}`, kind: "text" as const, label: `Representative — ${field}` })),
  { id: "home.official.identity.phone", kind: "link" as const, label: "Representative — phone" },
];
