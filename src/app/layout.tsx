import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rift Delta — LoL damage simulator",
  description:
    "Patch-pinned League damage comparisons using inspectable mechanics and match snapshots.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
