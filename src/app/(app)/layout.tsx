import { AppHeader } from "@/components/layout/app-header";
import { SideNav } from "@/components/layout/side-nav";
import { requireUser } from "@/server/auth/session";
import { logout } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <>
      <AppHeader
        facilityName={user.facilityName}
        accreNo={user.accreNo}
        userName={user.displayName}
        onLogout={logout}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row">
        <SideNav />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
