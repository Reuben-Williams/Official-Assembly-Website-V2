// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as feature from "../app/admin/editor/calendar-translation";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const source = { titleEn: "Meeting", descriptionEn: "Public information.", actionLabelEn: "" };
const spanish = { titleEs: "", descriptionEs: "", actionLabelEs: "" };
const suggestion = { titleEs: "Reunión", descriptionEs: "Información pública.", actionLabelEs: "" };
const button = (name: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent?.trim() === name)!;
describe("calendar translation staff review", () => {
  it("clearly disables unavailable automatic translation", async () => {
    expect(feature?.CalendarTranslation).toBeTypeOf("function"); if (!feature) return;
    await act(async () => root.render(<feature.CalendarTranslation source={source} spanish={spanish} draftIdentity="event-1" onApply={vi.fn()} client={{ available: async () => false, suggest: vi.fn() }} />));
    expect(button("Suggest Spanish").disabled).toBe(true);
    expect(host.textContent).toContain("provider is not configured");
  });
  it("requires sending consent and a separate explicit apply, without saving", async () => {
    expect(feature).not.toBeNull(); if (!feature) return;
    const suggest = vi.fn(async () => suggestion), apply = vi.fn();
    await act(async () => root.render(<feature.CalendarTranslation source={source} spanish={spanish} draftIdentity="event-1" onApply={apply} client={{ available: async () => true, suggest }} />));
    await act(async () => button("Suggest Spanish").click());
    expect(host.querySelector("dialog")?.textContent).toContain("Public information.");
    expect(suggest).not.toHaveBeenCalled();
    await act(async () => button("Confirm and suggest").click());
    expect(suggest).toHaveBeenCalledExactlyOnceWith(source);
    expect(apply).not.toHaveBeenCalled();
    await act(async () => button("Apply to draft").click());
    expect(apply).toHaveBeenCalledExactlyOnceWith(suggestion);
  });
  it("requires replacement confirmation for existing Spanish", async () => {
    expect(feature).not.toBeNull(); if (!feature) return;
    await act(async () => root.render(<feature.CalendarTranslation source={source} spanish={{ ...spanish, titleEs: "Título aprobado" }} draftIdentity="event-1" onApply={vi.fn()} client={{ available: async () => true, suggest: async () => suggestion }} />));
    await act(async () => button("Suggest Spanish").click());
    await act(async () => button("Confirm and suggest").click());
    expect(button("Apply to draft").disabled).toBe(true);
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => checkbox.click());
    expect(button("Apply to draft").disabled).toBe(false);
  });
  it("discards late suggestions when the form changes", async () => {
    expect(feature).not.toBeNull(); if (!feature) return;
    let complete!: (value: typeof suggestion) => void;
    const client = { available: async () => true, suggest: () => new Promise<typeof suggestion>(resolve => { complete = resolve; }) };
    const apply = vi.fn();
    await act(async () => root.render(<feature.CalendarTranslation source={source} spanish={spanish} draftIdentity="event-1" onApply={apply} client={client} />));
    await act(async () => button("Suggest Spanish").click());
    await act(async () => button("Confirm and suggest").click());
    await act(async () => root.render(<feature.CalendarTranslation source={{ ...source, titleEn: "Changed" }} spanish={spanish} draftIdentity="event-1" onApply={apply} client={client} />));
    await act(async () => complete(suggestion));
    expect(host.querySelector("dialog")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});
