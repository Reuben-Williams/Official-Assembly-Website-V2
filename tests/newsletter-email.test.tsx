import { describe, expect, it } from "vitest";

import { renderNewsletterConfirmationEmail } from "../lib/newsletter/email/render-confirmation";

describe("newsletter confirmation email", () => {
  it("renders the approved bilingual transactional content in HTML and plain text", async () => {
    const confirmationUrl =
      "https://www.assemblywomanmorales.com/newsletter/confirm#token=signed-fragment";
    const rendered = await renderNewsletterConfirmationEmail({ confirmationUrl });

    expect(rendered.subject).toBe("Confirm your District Newsletter subscription");
    for (const content of [rendered.html, rendered.text]) {
      expect(content).toContain("Confirm your subscription");
      expect(content).toContain("Confirme su suscripción");
      expect(content).toContain("48 hours");
      expect(content).toContain("no action is required");
      expect(content).toContain("not monitored");
      expect(content).toContain("https://www.assemblywomanmorales.com/contact");
      expect(content).toContain("973-450-0484");
      expect(content).toContain(confirmationUrl.replaceAll("&", "&amp;").replace("#", "#"));
    }
    expect(rendered.html).toContain("One more step to receive updates from the Office of Assemblywoman Carmen Morales.");
    expect(rendered.html).not.toContain("You are subscribed");
  });
});
