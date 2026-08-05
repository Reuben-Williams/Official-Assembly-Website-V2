import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DashboardWorkspacePage() {
  redirect("/admin/editor?workspace=growth.dashboard");
}
