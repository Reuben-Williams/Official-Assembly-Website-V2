import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LeadsWorkspacePage() {
  redirect("/admin/editor?workspace=growth.leads");
}
