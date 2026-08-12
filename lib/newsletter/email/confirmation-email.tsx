import "server-only";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

const CONTACT_URL = "https://www.assemblywomanmorales.com/contact";

export function NewsletterConfirmationEmail({
  confirmationUrl,
  locale = "en",
}: {
  readonly confirmationUrl: string;
  readonly locale?: "en" | "es";
}) {
  const spanish = locale === "es";
  const step = spanish
    ? "Un paso m\u00e1s para recibir novedades de la Oficina de la Asamble\u00edsta Carmen Morales."
    : "One more step to receive updates from the Office of Assemblywoman Carmen Morales.";
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{step}</Preview>
      <Body style={{ backgroundColor: "#f4f7fb", color: "#10284d", fontFamily: "Arial, sans-serif", margin: 0 }}>
        <Container style={{ backgroundColor: "#ffffff", margin: "32px auto", maxWidth: "600px", padding: "32px" }}>
          <Text style={{ color: "#356f78", fontSize: "14px", fontWeight: 700 }}>
            {spanish ? "Bolet\u00edn del distrito" : "District Newsletter"}
          </Text>
          <Heading style={{ fontSize: "28px", lineHeight: "36px" }}>
            {spanish ? "Confirme su suscripci\u00f3n" : "Confirm your subscription"}
          </Heading>
          <Text>{step}</Text>
          <Section style={{ margin: "28px 0" }}>
            <Button
              href={confirmationUrl}
              style={{ backgroundColor: "#1f4dc4", borderRadius: "6px", color: "#ffffff", padding: "14px 22px" }}
            >
              {spanish ? "Confirmar suscripci\u00f3n" : "Confirm subscription"}
            </Button>
          </Section>
          <Text>{spanish ? "Este enlace de confirmaci\u00f3n vence en 48 horas." : "This confirmation link expires in 48 hours."}</Text>
          <Text>{spanish ? "Si no solicit\u00f3 esta suscripci\u00f3n, no se requiere ninguna acci\u00f3n." : "If you did not request this subscription, no action is required."}</Text>
          <Text>
            {spanish ? "Esta direcci\u00f3n de env\u00edo no se supervisa. Comun\u00edquese con la oficina del distrito en " : "This sending address is not monitored. Contact the district office at "}
            <Link href={CONTACT_URL}>{CONTACT_URL}</Link>
            {spanish ? " o llame al 973-450-0484." : " or call 973-450-0484."}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
