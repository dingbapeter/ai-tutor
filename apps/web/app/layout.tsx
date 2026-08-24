import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import "./globals.css";
import Boot from "./Boot";
import Chrome from "./Chrome";

export const metadata = {
  title: "Dingba",
  description: "Your Personal A.I Tutor. Ask anything. Learn anything.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default" as const, title: "Dingba" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#6C5CE7" },
    { media: "(prefers-color-scheme: dark)", color: "#131320" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Boot />
        <Chrome />
        {children}
      </body>
    </html>
  );
}
