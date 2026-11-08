// Polls Upload Status for every queued submission. Run with: npm run worker

import { pollDueUploads } from "../src/server/uploads/poller";

const IDLE_MS = 1000;
let running = true;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    running = false;
  });
}

async function main() {
  console.log("Upload worker started.");
  while (running) {
    try {
      await pollDueUploads();
    } catch (error) {
      console.error("Upload worker pass failed:", error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }
  process.exit(0);
}

void main();
