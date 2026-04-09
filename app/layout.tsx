import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";


export const metadata: Metadata = {
  title: "Fork Zero",
  description: "ForkVerse Monte Carlo terminal interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html className="dark" lang="en">
      <body className="min-h-screen bg-[#030b07] font-mono text-emerald-50 antialiased">
        {children}
      </body>
    </html>
  );
}
