// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarWorkspace } from "../app/admin/editor/calendar-workspace";
import type { CalendarClient } from "../lib/calendar/client";
import type { CalendarManagementEvent } from "../lib/calendar/repository";
import { normalizeCalendarDraft } from "../lib/calendar/contract";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const siteId = "182c3a48-a024-452b-bc88-44e795c55b95";
const memberId = "24cdb58e-8cb4-4638-972f-649a01196e42";
const draftRevisionId = "60dca582-43fe-4f31-b3cf-820e2498082d";

function record(id: string, state: "draft" | "published" | "changed" | "archived", startAt = "2026-09-20T18:00:00.000Z"): CalendarManagementEvent {
  const publishedRevisionId = state === "published" || state === "changed"
    ? "7d3b3da1-51b6-4f85-a12b-3a3b691bba5d"
    : null;
  const draftId = state === "changed" ? draftRevisionId : publishedRevisionId ?? draftRevisionId;
  const draft = {
    id: draftId,
    parentRevisionId: null,
    eventId: id,
    siteId,
    ...normalizeCalendarDraft({
      titleEn: `Event ${id.slice(-1)}`,
      titleEs: `Evento ${id.slice(-1)}`,
      descriptionEn: "English description",
      descriptionEs: "Descripción en español",
      startAt,
      endAt: null,
      locationName: "District Office",
      locationAddress: "152 Franklin Street, Belleville, NJ 07109",
      publicApproved: true,
      hostedByOffice: true
    }),
    authorMemberId: memberId,
    createdAt: "2026-09-01T14:00:00.000Z"
  };
  return {
    entity: {
      id,
      siteId,
      lifecycleState: state === "archived" ? "archived" : "active",
      draftRevisionId: draftId,
      publishedRevisionId,
      createdByMemberId: memberId,
      updatedByMemberId: memberId,
      createdAt: "2026-09-01T14:00:00.000Z",
      updatedAt: "2026-09-01T14:00:00.000Z",
      publishedAt: publishedRevisionId ? "2026-09-01T14:05:00.000Z" : null,
      archivedAt: state === "archived" ? "2026-09-02T14:00:00.000Z" : null,
      commandVersion: 2
    },
    draftRevision: draft,
    publishedRevision: publishedRevisionId ? { ...draft, id: publishedRevisionId } : null
  };
}

function client(events: CalendarManagementEvent[] = []): CalendarClient {
  return {
    list: vi.fn(async () => ({ schemaVersion: 1 as const, events })),
    command: vi.fn(async (command) => ({
      schemaVersion: 1 as const,
      command: command.command,
      event: record(command.eventId ?? "00000000-0000-4000-8000-000000000099", "draft")
    }))
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("Calendar editor workspace", () => {
  it("classifies every event once and labels past and unpublished-change states", async () => {
    const events = [
      record("00000000-0000-4000-8000-000000000001", "draft"),
      record("00000000-0000-4000-8000-000000000002", "published", "2026-08-01T18:00:00.000Z"),
      record("00000000-0000-4000-8000-000000000003", "changed"),
      record("00000000-0000-4000-8000-000000000004", "archived")
    ];
    await act(async () => root.render(
      <CalendarWorkspace client={client(events)} now={() => new Date("2026-09-10T12:00:00.000Z")} role="owner" />
    ));
    await settle();

    expect(host.textContent).toContain("Drafts");
    expect(host.textContent).toContain("Published");
    expect(host.textContent).toContain("Archived");
    expect(host.textContent).toContain("Past");
    expect(host.textContent).toContain("Unpublished changes");
    for (const event of events) {
      expect(host.querySelectorAll(`[data-calendar-event-id="${event.entity.id}"]`)).toHaveLength(1);
    }
  });

  it("shows clear required and optional fields and submits a normalized bilingual draft", async () => {
    const operations = client();
    await act(async () => root.render(<CalendarWorkspace client={operations} role="contributor" />));
    await settle();
    const newButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "New event")!;
    await act(async () => newButton.click());

    expect(host.textContent).toContain("Fields marked * are required to publish");
    expect(host.textContent).toContain("Event image (optional)");
    expect(host.textContent).toContain("Official action URL (optional)");
    expect(host.querySelector('input[name="titleEn"]')?.getAttribute("aria-required")).toBe("true");
    expect(host.querySelector('input[name="titleEs"]')?.getAttribute("aria-required")).toBe("true");
    expect(host.querySelector('input[name="titleEn"]')).toHaveProperty("required", false);

    const set = async (selector: string, value: string) => {
      const element = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
        setter?.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await set('input[name="titleEn"]', " District meeting ");
    await set('input[name="titleEs"]', " Reunión del distrito ");
    await set('textarea[name="descriptionEn"]', " English description ");
    await set('textarea[name="descriptionEs"]', " Descripción en español ");
    await set('input[name="startLocal"]', "2026-09-20T14:00");
    await set('input[name="locationName"]', " District Office ");
    await set('input[name="locationAddress"]', " 152 Franklin Street, Belleville, NJ 07109 ");

    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Create draft")!;
    await act(async () => save.click());
    await settle();

    expect(operations.command).toHaveBeenCalledWith(expect.objectContaining({
      command: "create_draft",
      eventId: null,
      expectedVersion: 0,
      idempotencyKey: expect.stringMatching(/^calendar:create_draft:/),
      draft: expect.objectContaining({
        titleEn: "District meeting",
        titleEs: "Reunión del distrito",
        startAt: "2026-09-20T18:00:00.000Z"
      })
    }));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Draft created");
  });

  it("allows an incomplete draft save while keeping publication requirements visible", async () => {
    const operations = client();
    await act(async () => root.render(<CalendarWorkspace client={operations} role="contributor" />));
    await settle();
    const newButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "New event")!;
    await act(async () => newButton.click());
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Create draft")!;
    await act(async () => save.click());
    await settle();

    expect(operations.command).toHaveBeenCalledWith(expect.objectContaining({
      command: "create_draft",
      draft: expect.objectContaining({ titleEn: "", titleEs: "", startAt: null })
    }));
  });

  it("keeps viewers read-only and exposes role-appropriate lifecycle controls", async () => {
    const published = record("00000000-0000-4000-8000-000000000002", "changed");
    await act(async () => root.render(<CalendarWorkspace client={client([published])} role="viewer" />));
    await settle();
    expect(host.textContent).toContain("Read-only access");
    expect(host.textContent).not.toContain("New event");

    await act(async () => root.render(<CalendarWorkspace client={client([published])} role="editor" />));
    await settle();
    const row = host.querySelector(`[data-calendar-event-id="${published.entity.id}"] button`)! as HTMLButtonElement;
    await act(async () => row.click());
    expect(Array.from(host.querySelectorAll("button")).map((button) => button.textContent?.trim())).toEqual(
      expect.arrayContaining(["Save draft", "Publish", "Unpublish", "Archive"])
    );
  });

  it("warns about unsaved changes and offers a safe refresh after a conflict", async () => {
    const base = client([record("00000000-0000-4000-8000-000000000001", "draft")]);
    const operations = {
      ...base,
      command: vi.fn(async () => { throw new Error("The event changed. Refresh and try again."); })
    } as CalendarClient;
    await act(async () => root.render(<CalendarWorkspace client={operations} role="editor" />));
    await settle();
    const row = host.querySelector('[data-calendar-event-id] button')! as HTMLButtonElement;
    await act(async () => row.click());
    const title = host.querySelector('input[name="titleEn"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(title, "Changed title");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Save draft")!;
    await act(async () => save.click());
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("event changed");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent === "Refresh event list")).toBe(true);
  });
});
