"use client";

import "./globals.css";
import { inter } from "./fonts";
import { THEME_PRE_PAINT_SCRIPT } from "./theme-script";
import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

/**
 * The last boundary: it replaces the root layout, so it owns `<html>` and
 * `<body>` and has to restate what the layout normally provides — the
 * stylesheet, the typeface and the theme stamp. Without that stamp a reader
 * in dark mode would be handed a white page at the worst possible moment.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <main>
          <StatusMessage
            title="Something went wrong"
            description="The Hub could not finish loading. Nothing was changed."
            action={<Button variant="secondary" size="lg" onClick={() => reset()}>Reload</Button>}
          />
        </main>
      </body>
    </html>
  );
}
