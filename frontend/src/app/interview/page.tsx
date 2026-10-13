import { connection } from "next/server";

import InterviewClient from "./interview-client";

// The proxy refreshes the Supabase session and redirects signed-out users before this page renders.
export default async function Page() {
  await connection(); // Always evaluated per request: the auth check must never be baked in at build time.
  return <InterviewClient />;
}
