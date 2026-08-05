import { isSafeReturnPath } from "../../../lib/builder/authorization";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ complete?: string; returnTo?: string }>;
}) {
  const parameters = await searchParams;
  const requested = parameters.returnTo ?? "/admin/editor";
  const returnTo = isSafeReturnPath(requested) ? requested : "/admin/editor";
  return (
    <section className="section admin-login">
      <div className="container">
        <div className="form-panel admin-login-panel">
          <p className="eyebrow">Authorized staff only</p>
          <h1>Site Editor</h1>
          <p>
            Sign in with an approved site member account. Public visitors cannot open drafts,
            publishing controls, submission records, or media tools.
          </p>
          <LoginForm complete={parameters.complete === "1"} returnTo={returnTo} />
        </div>
      </div>
    </section>
  );
}
