import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CustomersWorkspacePage() {
  redirect("/admin/editor?workspace=growth.customers");
}
