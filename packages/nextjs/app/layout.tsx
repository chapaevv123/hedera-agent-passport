import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Passport",
  description: "Verifiable HCS-10 identity, communication and decision log for AI agents on Hedera.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
