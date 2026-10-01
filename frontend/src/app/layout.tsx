import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";

import { AuthSessionGuard } from "@/components/auth/auth-session-guard";
import { dmSans, instrumentSerif } from "@/lib/landing-fonts";

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
      className={`${dmSans.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthSessionGuard />
        {children}
      </body>
    </html>
  );
}
