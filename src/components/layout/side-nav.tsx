"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Items without an href are built in later phases.
const ITEMS: { label: string; href?: string }[] = [
  { label: "Home", href: "/" },
  { label: "Primary Care Validator", href: "/validator" },
  { label: "Patient verification", href: "/verification" },
  { label: "Selection" },
  { label: "First Patient Encounter" },
  { label: "Empanelment" },
  { label: "Clinical uploads" },
  { label: "Upload status" },
  { label: "Selection masterlist" },
  { label: "Availment slip" },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="h-fit w-full shrink-0 rounded-xl border border-line bg-card p-3 lg:w-60"
    >
      <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-muted">YAKAP</p>
      <ul className="flex flex-col gap-0.5">
        {ITEMS.map(({ label, href }) => (
          <li key={label}>
            {href ? (
              <Link
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={`block rounded-md px-2 py-2 text-sm ${
                  pathname === href
                    ? "bg-primary-soft font-semibold text-navy"
                    : "text-ink hover:bg-surface"
                }`}
              >
                {label}
              </Link>
            ) : (
              <span aria-disabled className="block px-2 py-2 text-sm text-muted/60">
                {label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
