import { describe, expect, it } from "vitest";

import { renderNewsletterConfirmationEmail } from "../lib/newsletter/email/render-confirmation";

const confirmationUrl =
  "https://www.assemblywomanmorales.com/newsletter/confirm#token=signed-fragment";

describe("newsletter confirmation email", () => {
  it("renders complete English transactional content", async () => {
    const rendered = await renderNewsletterConfirmationEmail({ confirmationUrl, locale: "en" });

    expect(rendered.subject).toBe("Confirm your District Newsletter subscription");
    for (const content of [rendered.html, rendered.text]) {
      expect(content).toContain("Confirm your subscription");
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

  it("renders complete Spanish transactional content and subject", async () => {
    const rendered = await renderNewsletterConfirmationEmail({ confirmationUrl, locale: "es" });
    expect(rendered.subject).toBe("Confirme su suscripci\u00f3n al Bolet\u00edn del distrito");
    for (const content of [rendered.html, rendered.text]) {
      expect(content).toContain("Confirme su suscripci\u00f3n");
      expect(content).toContain("48 horas");
      expect(content).toContain("no se requiere ninguna acci\u00f3n");
      expect(content).not.toContain("One more step");
    }
  });
});
