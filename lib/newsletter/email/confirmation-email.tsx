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
  Text
} from "react-email";

const CONTACT_URL = "https://www.assemblywomanmorales.com/contact";

export function NewsletterConfirmationEmail({ confirmationUrl }: { readonly confirmationUrl: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>One more step to receive updates from the Office of Assemblywoman Carmen Morales.</Preview>
      <Body style={{ backgroundColor: "#f4f7fb", color: "#10284d", fontFamily: "Arial, sans-serif", margin: 0 }}>
        <Container style={{ backgroundColor: "#ffffff", margin: "32px auto", maxWidth: "600px", padding: "32px" }}>
          <Text style={{ color: "#356f78", fontSize: "14px", fontWeight: 700 }}>District Newsletter</Text>
          <Heading style={{ fontSize: "28px", lineHeight: "36px" }}>
            Confirm your subscription / Confirme su suscripción
          </Heading>
          <Text>One more step to receive updates from the Office of Assemblywoman Carmen Morales.</Text>
          <Section style={{ margin: "28px 0" }}>
            <Button
              href={confirmationUrl}
              style={{ backgroundColor: "#1f4dc4", borderRadius: "6px", color: "#ffffff", padding: "14px 22px" }}
            >
              Confirm subscription / Confirmar suscripción
            </Button>
          </Section>
          <Text>This confirmation link expires in 48 hours.</Text>
          <Text>If you did not request this subscription, no action is required.</Text>
          <Text>
            This sending address is not monitored. Contact the district office at{" "}
            <Link href={CONTACT_URL}>{CONTACT_URL}</Link> or call 973-450-0484.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
