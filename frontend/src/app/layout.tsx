import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";

import { AuthSessionGuard } from "@/components/auth/auth-session-guard";
import { instrumentSans, instrumentSerif } from "@/lib/fonts";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/color-scheme.mjs";

import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "English Interview Agent — inglês de entrevista para dev brasileiro",
  description: "Entrevista em inglês para dev brasileiro mirando vaga na gringa. No fim, um relatório do seu inglês sob pressão.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      data-theme="interview-light"
      data-color-scheme="light"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Runs while the HTML is parsed, before first paint: applies the stored/OS scheme so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthSessionGuard />
        {children}
      </body>
    </html>
  );
}
