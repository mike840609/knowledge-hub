import type { Metadata } from "next";
import { headers } from "next/headers";
import { NONCE_HEADER } from "@/lib/content-security-policy";
import "./globals.css";
import { inter } from "./fonts";
import { THEME_PRE_PAINT_SCRIPT } from "./theme-script";

export const metadata: Metadata = {
  title: "Knowledge Hub",
  description: "A Markdown knowledge workspace for writing, linking, and sharing.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The middleware's nonce for this response (`middleware.ts`); without it the policy refuses the script.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    // The pre-paint script stamps data-theme on <html> before React hydrates,
    // on purpose (§12 of the design contract), so the server HTML never has it.
    // This silences that one attribute mismatch; it does not reach children.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
