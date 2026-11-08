import { AppHeader } from "@/components/layout/app-header";
import { SideNav } from "@/components/layout/side-nav";
import { requireUser } from "@/server/auth/session";
import { logout } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-navy"
      >
        Skip to main content
      </a>
      <AppHeader
        facilityName={user.facilityName}
        accreNo={user.accreNo}
        userName={user.displayName}
        onLogout={logout}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row">
        <SideNav isAdmin={user.role === "admin"} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>
    </>
  );
}
