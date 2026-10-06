export type CalendarTextField = "title" | "description" | "actionLabel";
type CalendarText = { titleEn: string; titleEs: string; descriptionEn: string; descriptionEs: string; actionLabelEn: string; actionLabelEs: string };

/** Keep untranslated source text distinct from an actual Spanish translation. */
export function localizedCalendarField(event: CalendarText, locale: "en" | "es", field: CalendarTextField) {
  const english = event[`${field}En`].trim();
  const spanish = event[`${field}Es`].trim();
  const translated = locale === "es" && Boolean(spanish);
  return { text: translated ? spanish : english, lang: translated ? "es" : "en", fallback: locale === "es" && !spanish } as const;
}
