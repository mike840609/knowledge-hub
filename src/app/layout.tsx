import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// A dense UI leans on the typeface. Inter holds up at 11-14px where the
// system stack varies by platform; figures are made tabular per call site.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--kh-font-sans",
});

export const metadata: Metadata = {
  title: "TSMC Knowledge Hub",
  description: "Phase 0 foundation for source governed team knowledge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
