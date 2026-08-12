export function previewLocaleRequestHeaders(url: URL, current: Headers): Headers {
  const headers = new Headers(current);
  const locale = url.searchParams.get("builderLocale");
  if (url.searchParams.get("builderPreview") === "1" && (locale === "en" || locale === "es")) {
    headers.set("x-builder-preview-url", `${url.pathname}${url.search}`);
  } else {
    headers.delete("x-builder-preview-url");
  }
  return headers;
}
