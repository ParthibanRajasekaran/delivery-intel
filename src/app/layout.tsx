import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delivery Intel — Software Delivery Intelligence",
  description:
    "Analyze any GitHub repository's delivery performance with DORA metrics, vulnerability scanning, and actionable suggestions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
