export type CalendarTranslationSource = { titleEn: string; descriptionEn: string; actionLabelEn: string };
export type CalendarTranslationSuggestion = { titleEs: string; descriptionEs: string; actionLabelEs: string };
export type CalendarTranslationClient = {
  available(): Promise<boolean>;
  suggest(source: CalendarTranslationSource): Promise<CalendarTranslationSuggestion>;
};
