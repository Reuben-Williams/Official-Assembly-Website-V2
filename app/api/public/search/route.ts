import { loadPublicSearchEntries } from "../../../../lib/public-search-server";
import { normalizePublicLocale } from "../../../i18n/locale";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const locale = normalizePublicLocale(new URL(request.url).searchParams.get("locale"));
  try {
    // One public index per search session; typing filters locally rather than
    // querying the database for every character. Never include editor data.
    const index = await loadPublicSearchEntries(locale);
    return Response.json(index, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Search is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
