import localFont from "next/font/local";

// A dense UI leans on the typeface. Inter holds up at 11-14px where the
// system stack varies by platform; figures are made tabular per call site.
// Shared so that `global-error`, which replaces the root layout, renders in
// the same typeface rather than falling back to the system stack.
export const inter = localFont({
  src: "./font-assets/inter-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  adjustFontFallback: "Arial",
  display: "swap",
  variable: "--kh-font-sans",
});
