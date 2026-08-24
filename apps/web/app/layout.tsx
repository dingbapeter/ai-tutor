import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import Boot from "./Boot";

export const metadata = {
  title: "Dingba",
  description: "Your Personal A.I Tutor. Ask anything. Learn anything.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default" as const, title: "Dingba" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6C5CE7",
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
