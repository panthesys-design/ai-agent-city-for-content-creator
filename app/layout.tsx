import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Creator City — Agent Workspace",
  description: "A customizable isometric city for your AI content creation team.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
