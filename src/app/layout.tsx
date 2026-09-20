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
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
