import { requireAdmin } from "@/server/auth/session";
import { facilityStatus, listStaff } from "@/server/admin/service";
import { AdminPanel } from "./admin-panel";

export const metadata = { title: "Administration" };

export default async function AdminPage() {
  const user = await requireAdmin();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">Administration</h1>
        <p className="mt-1 text-muted">Manage staff accounts and this clinic&apos;s PhilHealth key.</p>
      </header>
      <AdminPanel
        currentUserId={user.id}
        staff={await listStaff(user)}
        facility={await facilityStatus(user)}
      />
    </div>
  );
}
