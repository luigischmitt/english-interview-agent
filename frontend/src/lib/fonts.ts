import { Instrument_Sans, Instrument_Serif } from "next/font/google";

// Site-wide font definitions. Loaded once in the root layout (src/app/layout.tsx);
// next/font hosts one instance per call, so nothing else should call these constructors.
//
// - Instrument Sans: the UI face (body, labels, buttons, inputs). Exposed as `--font-sans` in Tailwind.
// - Instrument Serif: display face for large titles only. Use `font-display` (Tailwind) or `var(--font-display)`.
export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument-sans",
});

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});
