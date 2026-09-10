import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TSMC Knowledge Hub",
  description: "Phase 0 foundation for source governed team knowledge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
