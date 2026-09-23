import type { Metadata } from "next";
import "./globals.css";
import { inter } from "./fonts";
import { THEME_PRE_PAINT_SCRIPT } from "./theme-script";

export const metadata: Metadata = {
  title: "TSMC Knowledge Hub",
  description: "Phase 0 foundation for source governed team knowledge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The pre-paint script stamps data-theme on <html> before React hydrates,
    // on purpose (§12 of the design contract), so the server HTML never has it.
    // This silences that one attribute mismatch; it does not reach children.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
