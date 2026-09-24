import type { Metadata } from "next";

import { LandingPage } from "./_landing/landing-page";

export const metadata: Metadata = {
  title: "English Interview Agent — inglês de entrevista para dev brasileiro",
};

export default function Page() {
  return <LandingPage />;
}
