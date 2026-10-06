"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, CalendarDays, Clock3, MapPin, RotateCcw } from "lucide-react";
import { CalendarDialog } from "./calendar-dialog";
import { CalendarTranslation } from "./calendar-translation";
import { CalendarImagePicker, type CalendarMediaChoice } from "./calendar-image-picker";
import { localizedCalendarField } from "../../../lib/calendar/localization";

import {
  calendarIsoToLocalInput,
  calendarLocalDateTimeToIso,
  getEffectiveCalendarEnd,
  normalizeCalendarDraft,
  type CalendarCommand,
  type CalendarDraftInput,
  type CalendarRole
} from "../../../lib/calendar/contract";
import {
  createHttpCalendarClient,
  type CalendarClient
} from "../../../lib/calendar/client";
import type {
  CalendarManagementCollection,
  CalendarManagementEvent
} from "../../../lib/calendar/repository";
import { builderSessionCookies } from "../../../lib/builder/session-cookies";
import styles from "./calendar-workspace.module.css";

type CalendarFormState = {
  titleEn: string;
  titleEs: string;
  descriptionEn: string;
  descriptionEs: string;
  startLocal: string;
  endLocal: string;
  locationName: string;
  locationAddress: string;
  actionUrl: string;
  actionLabelEn: string;
  actionLabelEs: string;
  mediaAssetId: string;
  publicApproved: boolean;
  hostedByOffice: boolean;
};

const emptyCollection: CalendarManagementCollection = { schemaVersion: 1, events: [] };
const emptyMediaAssets: readonly CalendarMediaChoice[] = [];
const currentDate = () => new Date();

function csrfCookie() {
  for (const item of document.cookie.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name === builderSessionCookies.csrf) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function blankForm(): CalendarFormState {
  return {
    titleEn: "",
    titleEs: "",
    descriptionEn: "",
    descriptionEs: "",
    startLocal: "",
    endLocal: "",
    locationName: "",
    locationAddress: "",
    actionUrl: "",
    actionLabelEn: "",
    actionLabelEs: "",
    mediaAssetId: "",
    publicApproved: false,
    hostedByOffice: false
  };
}

function formFor(event: CalendarManagementEvent): CalendarFormState {
  const revision = event.draftRevision ?? event.publishedRevision;
  if (!revision) return blankForm();
  return {
    titleEn: revision.titleEn,
    titleEs: revision.titleEs,
    descriptionEn: revision.descriptionEn,
    descriptionEs: revision.descriptionEs,
    startLocal: calendarIsoToLocalInput(revision.startAt),
    endLocal: calendarIsoToLocalInput(revision.endAt),
    locationName: revision.locationName,
    locationAddress: revision.locationAddress,
    actionUrl: revision.actionUrl ?? "",
    actionLabelEn: revision.actionLabelEn,
    actionLabelEs: revision.actionLabelEs,
    mediaAssetId: revision.mediaAssetId ?? "",
    publicApproved: revision.publicApproved,
    hostedByOffice: revision.hostedByOffice
  };
}

function draftFor(form: CalendarFormState): CalendarDraftInput {
  return {
    titleEn: form.titleEn,
    titleEs: form.titleEs,
    descriptionEn: form.descriptionEn,
    descriptionEs: form.descriptionEs,
    startAt: form.startLocal ? calendarLocalDateTimeToIso(form.startLocal) : null,
    endAt: form.endLocal ? calendarLocalDateTimeToIso(form.endLocal) : null,
    locationName: form.locationName,
    locationAddress: form.locationAddress,
    actionUrl: form.actionUrl || null,
    actionLabelEn: form.actionLabelEn,
    actionLabelEs: form.actionLabelEs,
    mediaAssetId: form.mediaAssetId || null,
    publicApproved: form.publicApproved,
    hostedByOffice: form.hostedByOffice
  };
}

function eventTitle(event: CalendarManagementEvent) {
  return event.draftRevision?.titleEn || event.publishedRevision?.titleEn || "Untitled event";
}

function eventStart(event: CalendarManagementEvent) {
  return event.draftRevision?.startAt ?? event.publishedRevision?.startAt ?? null;
}

function isPast(event: CalendarManagementEvent, now: Date) {
  if (!event.publishedRevision) return false;
  return new Date(getEffectiveCalendarEnd(event.publishedRevision)).getTime() <= now.getTime();
}

function eventDate(value: string | null) {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York"
  }).format(new Date(value));
}

function localEventDate(value: string) {
  if (!value) return "Date not set";
  try {
    return eventDate(calendarLocalDateTimeToIso(value));
  } catch {
    return "Check the selected date and time";
  }
}

function commandNotice(command: CalendarCommand) {
  return {
    create_draft: "Draft created.",
    save_draft: "Draft saved.",
    publish: "Event published.",
    unpublish: "Event unpublished and retained as a draft.",
    archive: "Event deleted. Saved revisions are retained and can be restored to Drafts.",
    restore_to_draft: "Event restored to Drafts."
  }[command];
}

export function CalendarWorkspace({
  role,
  client,
  mediaAssets = emptyMediaAssets,
  mediaLoading = false,
  mediaError = "",
  onRefreshMedia,
  now = currentDate
}: {
  role: CalendarRole;
  client?: CalendarClient;
  mediaAssets?: readonly CalendarMediaChoice[];
  mediaLoading?: boolean;
  mediaError?: string;
  onRefreshMedia?: () => Promise<void>;
  now?: () => Date;
}) {
  const defaultClient = useMemo(() => createHttpCalendarClient({ getCsrfToken: csrfCookie }), []);
  const operations = client ?? defaultClient;
  const [collection, setCollection] = useState<CalendarManagementCollection>(emptyCollection);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CalendarFormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const canEditDrafts = role !== "viewer";
  const canManageLifecycle = role === "owner" || role === "editor";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await operations.list();
      setCollection(next);
      setSelectedId((current) => current && next.events.some((event) => event.entity.id === current) ? current : null);
    } catch {
      setError("The calendar service is temporarily unavailable. No event data was changed.");
    } finally {
      setLoading(false);
    }
  }, [operations]);

  useEffect(() => {
    let active = true;
    void operations.list().then((next) => {
      if (!active) return;
      setCollection(next);
      setError("");
    }).catch(() => {
      if (!active) return;
      setError("The calendar service is temporarily unavailable. No event data was changed.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [operations]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const selected = collection.events.find((event) => event.entity.id === selectedId) ?? null;
  const groups = useMemo(() => collection.events.reduce((result, event) => {
    if (event.entity.lifecycleState === "archived") result.archived.push(event);
    else if (event.entity.publishedRevisionId) result.published.push(event);
    else result.drafts.push(event);
    return result;
  }, {
    drafts: [] as CalendarManagementEvent[],
    published: [] as CalendarManagementEvent[],
    archived: [] as CalendarManagementEvent[]
  }), [collection.events]);
  const evaluatedAt = now();

  function choose(event: CalendarManagementEvent) {
    setDeleteConfirmation(false);
    setSelectedId(event.entity.id);
    setCreating(false);
    setForm(formFor(event));
    setDirty(false);
    setNotice("");
    setError("");
  }

  function beginCreate() {
    setSelectedId(null);
    setCreating(true);
    setForm(blankForm());
    setDirty(false);
    setNotice("");
    setError("");
  }

  function cancelCreate() {
    setCreating(false);
    setForm(blankForm());
    setDirty(false);
    queueMicrotask(() => newButtonRef.current?.focus());
  }

  function update<K extends keyof CalendarFormState>(key: K, value: CalendarFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setNotice("");
  }

  function upsert(event: CalendarManagementEvent) {
    setCollection((current) => ({
      ...current,
      events: current.events.some((candidate) => candidate.entity.id === event.entity.id)
        ? current.events.map((candidate) => candidate.entity.id === event.entity.id ? event : candidate)
        : [event, ...current.events]
    }));
    setSelectedId(event.entity.id);
    setCreating(false);
    setForm(formFor(event));
  }

  async function run(command: CalendarCommand) {
    setBusy(command);
    setError("");
    setNotice("");
    try {
      const draft = command === "create_draft" || command === "save_draft"
        ? normalizeCalendarDraft(draftFor(form))
        : undefined;
      const result = await operations.command({
        command,
        eventId: selected?.entity.id ?? null,
        expectedVersion: selected?.entity.commandVersion ?? 0,
        idempotencyKey: `calendar:${command}:${crypto.randomUUID()}`,
        ...(draft ? { draft } : {})
      });
      upsert(result.event);
      setDirty(false);
      setNotice(commandNotice(command));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(/changed|refresh/i.test(message)
        ? "The event changed in another session. Refresh the event list before trying again."
        : "The calendar action could not be completed. Review the fields and try again.");
    } finally {
      setBusy("");
    }
  }

  const showEditor = creating || selected;
  const editorDisabled = !canEditDrafts || selected?.entity.lifecycleState === "archived" || Boolean(busy);
  const spanishTitle = localizedCalendarField(form, "es", "title");
  const spanishDescription = localizedCalendarField(form, "es", "description");

  return (
    <section className={styles.workspace} data-calendar-workspace>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Website · public information</p>
          <h1>Community events calendar</h1>
          <p>Create event drafts, add optional Spanish text, and publish approved office-hosted events.</p>
        </div>
        {canEditDrafts ? (
          <button className={styles.primaryButton} onClick={beginCreate} ref={newButtonRef} type="button">
            New event
          </button>
        ) : <span className={styles.readOnly}>Read-only access</span>}
      </header>

      {loading ? <p className={styles.status} role="status">Loading calendar events…</p> : null}
      {notice ? <p aria-live="polite" className={styles.notice} role="status">{notice}</p> : null}
      {error ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {/refresh/i.test(error) ? <button onClick={() => void refresh()} type="button">Refresh event list</button> : null}
        </div>
      ) : null}

      <div className={styles.layout}>
        <aside className={styles.eventRail} aria-label="Calendar event lists">
          {([
            ["Drafts", groups.drafts],
            ["Published", groups.published],
            ["Deleted events", groups.archived]
          ] as const).map(([label, events]) => (
            <section className={styles.eventGroup} key={label}>
              <h2>{label} <span>{events.length}</span></h2>
              {events.length ? (
                <ul>
                  {events.map((event) => {
                    const changed = Boolean(event.entity.publishedRevisionId &&
                      event.entity.draftRevisionId !== event.entity.publishedRevisionId);
                    const past = isPast(event, evaluatedAt);
                    return (
                      <li data-calendar-event-id={event.entity.id} key={event.entity.id}>
                        <button
                          aria-current={selectedId === event.entity.id ? "true" : undefined}
                          onClick={() => choose(event)}
                          type="button"
                        >
                          <strong>{eventTitle(event)}</strong>
                          <span><Clock3 aria-hidden="true" /> {eventDate(eventStart(event))}</span>
                          <span className={styles.badges}>
                            {past ? <em>Past</em> : null}
                            {changed ? <em>Unpublished changes</em> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p>No {label.toLowerCase()}.</p>}
            </section>
          ))}
        </aside>

        <div className={styles.editorPane}>
          {showEditor ? (
            <>
              <header className={styles.editorHeader}>
                <div>
                  <p className={styles.eyebrow}>{creating ? "New draft" : "Selected event"}</p>
                  <h2>{creating ? "Create an event draft" : eventTitle(selected!)}</h2>
                </div>
                {creating ? <button className={styles.secondaryButton} onClick={cancelCreate} type="button">Cancel</button> : null}
              </header>

              {selected?.entity.lifecycleState === "archived" ? (
                <p className={styles.archivedNote}>Deleted events retain their saved revisions. Restore to Drafts to edit; restoring does not republish the event.</p>
              ) : null}

              <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void run(creating ? "create_draft" : "save_draft"); }}>
                <p className={styles.requirements}>Fields marked * are required to publish. All fields may be saved in an incomplete draft.</p>
                <fieldset disabled={editorDisabled}>
                  <legend>English content</legend>
                  <label>English title *<input aria-required="true" maxLength={160} name="titleEn" onChange={(event) => update("titleEn", event.currentTarget.value)} value={form.titleEn} /></label>
                  <label>English description *<textarea aria-required="true" maxLength={5_000} name="descriptionEn" onChange={(event) => update("descriptionEn", event.currentTarget.value)} rows={5} value={form.descriptionEn} /></label>
                </fieldset>
                <fieldset disabled={editorDisabled}>
                  <legend>Spanish content</legend>
                  <p className={styles.hint}>Optional. English is shown when Spanish is blank; it is identified as English, not a translation.</p>
                  <CalendarTranslation disabled={Boolean(editorDisabled)} draftIdentity={creating ? "new" : selectedId ?? "none"}
                    source={{ titleEn: form.titleEn, descriptionEn: form.descriptionEn, actionLabelEn: form.actionLabelEn }}
                    spanish={{ titleEs: form.titleEs, descriptionEs: form.descriptionEs, actionLabelEs: form.actionLabelEs }}
                    onApply={suggestion => { setForm(current => ({ ...current, ...suggestion })); setDirty(true); setNotice("Suggestion applied to draft. Review, save, and publish when ready."); }} />
                  <label>Spanish title (optional)<input lang="es" maxLength={160} name="titleEs" onChange={(event) => update("titleEs", event.currentTarget.value)} value={form.titleEs} /></label>
                  <label>Spanish description (optional)<textarea lang="es" maxLength={5_000} name="descriptionEs" onChange={(event) => update("descriptionEs", event.currentTarget.value)} rows={5} value={form.descriptionEs} /></label>
                </fieldset>
                <fieldset disabled={editorDisabled}>
                  <legend>Date and location</legend>
                  <div className={styles.twoColumns}>
                    <label>Start date and time *<input aria-required="true" name="startLocal" onChange={(event) => update("startLocal", event.currentTarget.value)} type="datetime-local" value={form.startLocal} /></label>
                    <label>End date and time (optional)<input name="endLocal" onChange={(event) => update("endLocal", event.currentTarget.value)} type="datetime-local" value={form.endLocal} /></label>
                  </div>
                  <p className={styles.hint}>Dates and times are displayed in America/New_York.</p>
                  <label>Location name *<input aria-required="true" maxLength={200} name="locationName" onChange={(event) => update("locationName", event.currentTarget.value)} value={form.locationName} /></label>
                  <label>Location address *<input aria-required="true" maxLength={500} name="locationAddress" onChange={(event) => update("locationAddress", event.currentTarget.value)} value={form.locationAddress} /></label>
                </fieldset>
                <fieldset disabled={editorDisabled}>
                  <legend>Optional public action</legend>
                  <label>Official action URL (optional)<input inputMode="url" name="actionUrl" onChange={(event) => update("actionUrl", event.currentTarget.value)} placeholder="https://" value={form.actionUrl} /></label>
                  <div className={styles.twoColumns}>
                    <label>English link label (required with a URL)<input maxLength={120} name="actionLabelEn" onChange={(event) => update("actionLabelEn", event.currentTarget.value)} value={form.actionLabelEn} /></label>
                    <label>Spanish link label (optional)<input lang="es" maxLength={120} name="actionLabelEs" onChange={(event) => update("actionLabelEs", event.currentTarget.value)} value={form.actionLabelEs} /></label>
                  </div>
                </fieldset>
                <CalendarImagePicker value={form.mediaAssetId} onChange={value => update("mediaAssetId", value)}
                  mediaAssets={mediaAssets} disabled={Boolean(editorDisabled)} loading={mediaLoading} error={mediaError} onRefresh={onRefreshMedia} />
                <fieldset disabled={editorDisabled}>
                  <legend>Publication confirmations</legend>
                  <label className={styles.checkbox}><input checked={form.publicApproved} name="publicApproved" onChange={(event) => update("publicApproved", event.currentTarget.checked)} type="checkbox" />This event is approved for public display.</label>
                  <label className={styles.checkbox}><input checked={form.hostedByOffice} name="hostedByOffice" onChange={(event) => update("hostedByOffice", event.currentTarget.checked)} type="checkbox" />This event is hosted by the district office.</label>
                </fieldset>

                {canEditDrafts && selected?.entity.lifecycleState !== "archived" ? (
                  <div className={styles.actions}>
                    <button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">
                      {creating ? "Create draft" : "Save draft"}
                    </button>
                    {canManageLifecycle && selected?.entity.draftRevisionId ? <button disabled={Boolean(busy) || dirty} onClick={() => void run("publish")} type="button">Publish</button> : null}
                    {canManageLifecycle && selected?.entity.publishedRevisionId ? <button disabled={Boolean(busy)} onClick={() => void run("unpublish")} type="button">Unpublish</button> : null}
                    {canManageLifecycle && selected ? <button className={styles.dangerButton} disabled={Boolean(busy) || dirty} onClick={() => setDeleteConfirmation(true)} type="button"><Trash2 aria-hidden="true" /> Delete event</button> : null}
                  </div>
                ) : null}
                {dirty && canManageLifecycle && selected ? <p className={styles.hint}>Save or discard unsaved edits before deleting this event.</p> : null}
                {canManageLifecycle && selected?.entity.lifecycleState === "archived" ? (
                  <div className={styles.actions}>
                    <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => void run("restore_to_draft")} type="button"><RotateCcw aria-hidden="true" /> Restore to Drafts</button>
                  </div>
                ) : null}
              </form>

              <aside className={styles.preview} aria-label="Event preview">
                <p className={styles.eyebrow}>Public preview</p>
                <div className={styles.previewGrid}>
                  <article lang="en"><span>English</span><h3>{form.titleEn || "Untitled event"}</h3><p>{form.descriptionEn || "No English description yet."}</p></article>
                  <article lang="es"><span>Español{spanishTitle.fallback || spanishDescription.fallback ? " · English fallback" : ""}</span><h3 lang={spanishTitle.lang}>{spanishTitle.text || "Untitled event"}</h3><p lang={spanishDescription.lang}>{spanishDescription.text || "No description yet."}</p></article>
                </div>
                <p><CalendarDays aria-hidden="true" /> {localEventDate(form.startLocal)}</p>
                <p><MapPin aria-hidden="true" /> {[form.locationName, form.locationAddress].filter(Boolean).join(" · ") || "Location not set"}</p>
              </aside>
            </>
          ) : (
            <div className={styles.emptyEditor}>
              <CalendarDays aria-hidden="true" />
              <h2>Select an event</h2>
              <p>Choose an event from Drafts, Published, or Deleted events to review its details.</p>
            </div>
          )}
        </div>
      </div>
      {deleteConfirmation && selected ? <CalendarDialog title="Delete this event?" onClose={() => setDeleteConfirmation(false)}>
        <p><strong>{eventTitle(selected)}</strong> will be removed from the public calendar. Its saved revisions and history remain recoverable.</p>
        <p>Restore to Drafts recovers the latest saved draft without publishing it. Previously imported calendar copies cannot be removed by this website.</p>
        <div className={styles.actions}>
          <button autoFocus type="button" onClick={() => setDeleteConfirmation(false)}>Cancel</button>
          <button className={styles.dangerButton} type="button" onClick={() => { setDeleteConfirmation(false); void run("archive"); }}>Confirm deletion</button>
        </div>
      </CalendarDialog> : null}
    </section>
  );
}
