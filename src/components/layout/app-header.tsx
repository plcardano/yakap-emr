import { Button } from "@/components/ui/button";

export function Logo() {
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 items-center justify-center rounded-md bg-navy text-lg font-bold text-white"
    >
      Y
    </span>
  );
}

type AppHeaderProps = {
  facilityName: string;
  accreNo: string;
  userName: string;
  onLogout: () => Promise<void>;
};

export function AppHeader({ facilityName, accreNo, userName, onLogout }: AppHeaderProps) {
  return (
    <header className="border-b-4 border-accent bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-navy">YAKAP 2.0</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <p className="font-semibold text-navy">{facilityName}</p>
            <p className="text-muted">
              Accreditation No. {accreNo} · {userName}
            </p>
          </div>
          <form action={onLogout}>
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
