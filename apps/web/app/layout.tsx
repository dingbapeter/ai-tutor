import type { ReactNode } from "react";

export const metadata = { title: "AI Tutor" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f7fb", color: "#1a1a2e" }}>
        {children}
      </body>
    </html>
  );
}
