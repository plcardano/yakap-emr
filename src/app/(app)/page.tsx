import { Button } from "@/components/ui/button";
import { requireUser } from "@/server/auth/session";
import { BeneficiarySearch } from "./beneficiary-search";

const NOT_YET = "Not available yet.";

const tasks = [
  {
    title: "Primary Care Validator",
    body: "See where a beneficiary is in the YAKAP journey.",
    action: "Check status",
  },
  {
    title: "YAKAP Selection",
    body: "Assign a beneficiary to your clinic after verification.",
    action: "Start Selection",
  },
  {
    title: "Empanelment",
    body: "Record the Mutual Care Agreement after an accepted FPE.",
    action: "Open Empanelment",
  },
];

export default async function HomePage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">What do you need to do?</h1>
        <p className="mt-1 text-muted">Find a beneficiary, then pick the task.</p>
      </header>

      <BeneficiarySearch />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Tasks">
        {tasks.map((task) => (
          <article
            key={task.title}
            className="flex flex-col items-start gap-3 rounded-xl border border-line bg-card p-5"
          >
            <h2 className="text-lg font-semibold text-navy">{task.title}</h2>
            <p className="flex-1 text-sm text-muted">{task.body}</p>
            <Button variant="outline" disabledReason={NOT_YET}>
              {task.action}
            </Button>
          </article>
        ))}
      </section>
    </div>
  );
}
