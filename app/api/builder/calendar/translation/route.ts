import { configuredCalendarTranslationProvider, createCalendarTranslationHandlers } from "../../../../../lib/calendar/translation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) { return createCalendarTranslationHandlers({ provider: configuredCalendarTranslationProvider() }).GET(request); }
export async function POST(request: Request) { return createCalendarTranslationHandlers({ provider: configuredCalendarTranslationProvider() }).POST(request); }
