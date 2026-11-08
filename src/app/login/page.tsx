import { redirect } from "next/navigation";
import { Logo } from "@/components/layout/app-header";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border-t-4 border-accent bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <span className="text-lg font-semibold text-navy">YAKAP 2.0</span>
        </div>
        <h1 className="mb-6 text-2xl font-bold text-navy">Log in to your account</h1>
        <LoginForm />
      </div>
    </main>
  );
}
