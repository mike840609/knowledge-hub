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
      <head>
        {/* Applies a stored theme before first paint. Without a stored choice
            the CSS media query decides, so this stays a no-op. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("kh:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
