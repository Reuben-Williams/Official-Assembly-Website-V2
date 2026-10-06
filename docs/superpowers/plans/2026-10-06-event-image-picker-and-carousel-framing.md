# Implementation checklist

Approved spec: `docs/superpowers/specs/2026-10-06-event-image-picker-and-carousel-framing-design.md`.

1. Add failing CalendarWorkspace integration tests for visual selection, search, removal, identifier-only saving, media failure states, refresh, and read-only restrictions.
2. Implement a locally styled controlled image picker and pass existing authorized media previews/loading/refresh from EditorClient; keep all calendar commands unchanged.
3. Add failing replacement/framing tests, then default new replacements to contain and render complete images without masks, overlapping controls, or zoom at either device size; preserve explicit fill mode.
4. Run focused calendar/carousel tests, full application tests, TypeScript, lint, and guarded staged build. Check actual desktop/mobile behavior in the in-app browser without writing test records or starting Docker/WSL.
5. Promote the verified release. Inspect the latest owner carousel draft/publication for unrelated changes, then save/review/publish only centered complete framing on the five recent photos. Verify normal history/recovery and fresh live views; preserve the first three slides.

Do not bypass authentication/provider/recovery checks, expose signed URLs, alter event copy, or publish unrelated staff drafts. Stop and report any authority or concurrency conflict.
