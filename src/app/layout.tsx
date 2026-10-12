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
        {/* A browser keeps a script's nonce out of the attribute once the policy has read it, so the
            element React hydrates has `nonce=""` where the server wrote the value. That is the
            platform working; without this it is reported as a mismatch on every page. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
