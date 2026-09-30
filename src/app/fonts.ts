import { Inter, Geist_Mono } from "next/font/google";

// Inter 在 11–14px 撐住 dense UI；figures 逐處 tabular。
// global-error 取代 root layout，必須同字體。
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--kh-font-sans",
});

export const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--kh-font-mono",
});
