import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import Boot from "./Boot";

export const metadata = {
  title: "AI Tutor",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default" as const, title: "AI Tutor" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e8875a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f7fb", color: "#1a1a2e" }}>
        <Boot />
        {children}
      </body>
    </html>
  );
}
