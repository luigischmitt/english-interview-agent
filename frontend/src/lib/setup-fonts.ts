import { Instrument_Sans } from "next/font/google";

// UI face for the interview setup page only (scoped via the `.isu-root` class).
// Instrument Sans is the sans companion of the landing's Instrument Serif, so the page
// keeps the brand's family while staying clean and legible at small sizes.
export const setupSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-setup-sans",
});
