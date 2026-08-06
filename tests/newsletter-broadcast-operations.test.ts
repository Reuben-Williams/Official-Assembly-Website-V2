import { describe, expect, it, vi } from "vitest";

import {
  auditNewsletterBroadcastInventory,
  inspectNewsletterBroadcast,
  validateNewsletterBroadcast
} from "../lib/newsletter/broadcast-operations";
import { digestNewsletterBroadcast } from "../lib/newsletter/broadcast-digest";

const broadcast = {
  id: "broadcast-draft-1",
  name: "District update",
  from: "Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>",
  subject: "District update",
  replyTo: [] as string[],
  previewText: "News from District 34",
  html: "<p>District update</p><p>152 Franklin Street, Belleville, NJ 07109</p><p>973-450-0484</p><a href=\"https://www.assemblywomanmorales.com/contact\">Contact</a><a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\">Unsubscribe</a>",
  text: "District update\n152 Franklin Street, Belleville, NJ 07109\n973-450-0484\nhttps://www.assemblywomanmorales.com/contact\n{{{RESEND_UNSUBSCRIBE_URL}}}",
  segmentId: "segment-production",
  topicId: "topic-district-newsletter",
  status: "draft" as const,
  createdAt: "2026-08-06T16:00:00.000Z",
  scheduledAt: null,
  sentAt: null
};

describe("newsletter Broadcast operations", () => {
  it("uses a canonical digest over every send-relevant field", () => {
    const initial = digestNewsletterBroadcast(broadcast);
    expect(initial).toMatch(/^[a-f0-9]{64}$/);
    expect(digestNewsletterBroadcast({ ...broadcast })).toBe(initial);
    expect(digestNewsletterBroadcast({ ...broadcast, subject: "Edited" })).not.toBe(initial);
    expect(digestNewsletterBroadcast({ ...broadcast, topicId: "wrong-topic" })).not.toBe(initial);
  });

  it("performs content/config/readiness checks without creating or sending a Broadcast", async () => {
    const get = vi.fn(async () => broadcast);
    const reconcile = vi.fn(async () => ({
      readinessRevisionId: "34100000-0000-4000-8000-000000000001",
      audienceCount: 125
    }));
    const result = await inspectNewsletterBroadcast({ get }, {
      broadcastId: broadcast.id,
      segmentId: broadcast.segmentId,
      topicId: broadcast.topicId,
      reconcile
    });

    expect(result).toEqual(expect.objectContaining({
      state: "ready",
      broadcastId: broadcast.id,
      digest: digestNewsletterBroadcast(broadcast),
      audienceCount: 125
    }));
    expect(get).toHaveBeenCalledWith(broadcast.id);
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("requires an exact confirmed test and creates only a ten-minute database validation", async () => {
    const createValidation = vi.fn(async () => ({
      state: "valid" as const,
      validationId: "34400000-0000-4000-8000-000000000001"
    }));
    const result = await validateNewsletterBroadcast({ get: async () => broadcast }, {
      siteId: "34000000-0000-4000-8000-000000000001",
      commandId: "34200000-0000-4000-8000-000000000001",
      operatorId: "34300000-0000-4000-8000-000000000001",
      broadcastId: broadcast.id,
      segmentId: broadcast.segmentId,
      topicId: broadcast.topicId,
      confirmedTestObservationId: "34700000-0000-4000-8000-000000000001",
      reconcile: async () => ({
        readinessRevisionId: "34100000-0000-4000-8000-000000000001",
        audienceCount: 125
      }),
      createValidation
    });

    expect(result.state).toBe("valid");
    expect(createValidation).toHaveBeenCalledWith(expect.objectContaining({
      providerBroadcastId: broadcast.id,
      digest: digestNewsletterBroadcast(broadcast),
      confirmedTestObservationId: "34700000-0000-4000-8000-000000000001",
      sender: broadcast.from,
      replyToState: "none"
    }));
  });

  it("paginates the complete provider inventory with resumable per-page checkpoints", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ broadcasts: [{ ...broadcast, id: "draft-1" }], hasMore: true, after: "cursor-2" })
      .mockResolvedValueOnce({ broadcasts: [{ ...broadcast, id: "draft-2" }], hasMore: false });
    const checkpoint = vi.fn(async () => undefined);

    const result = await auditNewsletterBroadcastInventory({ list }, { after: null, checkpoint });

    expect(list.mock.calls).toEqual([
      [{ limit: 100, after: undefined }],
      [{ limit: 100, after: "cursor-2" }]
    ]);
    expect(checkpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({ hasMore: true, after: "cursor-2", pageCount: 1 }));
    expect(checkpoint).toHaveBeenNthCalledWith(2, expect.objectContaining({ hasMore: false, pageCount: 2 }));
    expect(result).toEqual({ complete: true, pageCount: 2, broadcastCount: 2 });
  });
});
