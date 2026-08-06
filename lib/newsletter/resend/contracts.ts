import "server-only";

export type ProviderResult<T> = Promise<{
  readonly data: T | null;
  readonly error: unknown;
}>;

export interface NewsletterEmailProvider {
  send(
    message: {
      readonly from: string;
      readonly to: string;
      readonly subject: string;
      readonly html: string;
      readonly text: string;
    },
    options: { readonly idempotencyKey: string }
  ): ProviderResult<{ readonly id: string }>;
}

export type NewsletterContactSnapshot = {
  readonly id: string;
  readonly unsubscribed: boolean;
};

export interface NewsletterContactProvider {
  getContact(input: { readonly id?: string; readonly email: string }): Promise<NewsletterContactSnapshot | null>;
  listTopics(input: { readonly contactId?: string; readonly email: string }): Promise<readonly {
    readonly id: string;
    readonly subscription: "opt_in" | "opt_out";
  }[]>;
  listSegments(input: { readonly contactId?: string; readonly email: string }): Promise<readonly {
    readonly id: string;
  }[]>;
  createContact(input: { readonly email: string; readonly firstName?: string }): Promise<{ readonly id: string }>;
  updateContact(input: { readonly id: string; readonly firstName?: string }): Promise<void>;
  updateTopics(input: { readonly id: string; readonly topicId: string; readonly subscription: "opt_in" | "opt_out" }): Promise<void>;
  addSegment(input: { readonly id: string; readonly segmentId: string }): Promise<void>;
}
