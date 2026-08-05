import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LoginForm } from "../app/admin/login/login-form";

describe("staff login", () => {
  it("uses an email-only passwordless sign-in flow", () => {
    const html = renderToStaticMarkup(<LoginForm returnTo="/admin/editor" />);

    expect(html).toContain('type="email"');
    expect(html).not.toContain('type="password"');
    expect(html).toContain("Send secure sign-in link");
  });
});
