import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Influencer Transcript Translator",
  description: "Paste Instagram, TikTok or YouTube post URLs and read English transcripts.",
  robots: { index: false, follow: false }, // belt to the X-Robots-Tag braces (NFR-4)
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
