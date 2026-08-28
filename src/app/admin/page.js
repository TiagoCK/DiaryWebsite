import { redirect } from "next/navigation";

/** The admin section has no landing page of its own. */
export default function AdminIndex() {
  redirect("/admin/pages");
}
