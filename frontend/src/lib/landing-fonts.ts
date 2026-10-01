import { DM_Sans, Instrument_Serif } from "next/font/google";

// Shared font definitions for the marketing/landing visual language.
// next/font/google hosts one instance per call across the whole app, so
// every component that wants these fonts imports them from here instead of
// calling DM_Sans()/Instrument_Serif() again.
export const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-landing-sans",
});

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-landing-serif",
});
