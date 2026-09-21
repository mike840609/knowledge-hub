import { Inter } from "next/font/google";

// A dense UI leans on the typeface. Inter holds up at 11-14px where the
// system stack varies by platform; figures are made tabular per call site.
// Shared so that `global-error`, which replaces the root layout, renders in
// the same typeface rather than falling back to the system stack.
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--kh-font-sans",
});
