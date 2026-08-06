import "server-only";

import { createHash } from "node:crypto";

export type NewsletterBroadcastSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly from: string;
  readonly subject: string;
  readonly replyTo: readonly string[];
  readonly previewText: string;
  readonly html: string;
  readonly text: string;
  readonly segmentId: string;
  readonly topicId: string;
  readonly status: "draft" | "queued" | "sent";
  readonly createdAt: string;
  readonly scheduledAt: string | null;
  readonly sentAt: string | null;
};

export function canonicalNewsletterBroadcast(value: NewsletterBroadcastSnapshot): string {
  return JSON.stringify({
    id: value.id,
    from: value.from,
    subject: value.subject,
    replyTo: [...value.replyTo],
    previewText: value.previewText,
    html: value.html,
    text: value.text,
    segmentId: value.segmentId,
    topicId: value.topicId
  });
}

export function digestNewsletterBroadcast(value: NewsletterBroadcastSnapshot): string {
  return createHash("sha256").update(canonicalNewsletterBroadcast(value), "utf8").digest("hex");
}
