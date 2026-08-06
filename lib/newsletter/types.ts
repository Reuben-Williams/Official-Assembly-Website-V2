import type { NewsletterErrorCode } from "./errors";

export type NewsletterEnvironment = "production" | "preview" | "development";

export type NewsletterConfigurationState =
  | {
      status: "disabled";
      code: "newsletter_disabled";
      environment: NewsletterEnvironment;
    }
  | {
      status: "unavailable";
      code: Exclude<NewsletterErrorCode, "newsletter_disabled">;
      environment: NewsletterEnvironment;
    }
  | {
      status: "ready";
      environment: "production";
      canonicalSiteUrl: string;
      segmentId: string;
      topicId: string;
      activeKeyId: string;
      verificationKeyIds: string[];
      testRecipientCount: number;
    };

export type NewsletterEnvironmentInput = Readonly<
  Record<string, string | undefined>
>;
