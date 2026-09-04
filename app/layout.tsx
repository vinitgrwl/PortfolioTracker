import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Family Ledger",
  description: "Consolidated family net worth — equities, crypto, mutual funds, FDs and ULIPs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
