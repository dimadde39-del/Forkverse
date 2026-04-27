import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import "./globals.css";

function resolveMetadataBase(): URL {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalizedCandidate =
      candidate.startsWith("http://") || candidate.startsWith("https://") ? candidate : `https://${candidate}`;

    try {
      return new URL(normalizedCandidate);
    } catch {
      continue;
    }
  }

  return new URL("http://localhost:3000");
}

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

const defaultOgImage = "/api/og?capital=5000000&income=450000&burn=950000&survival=37";

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: "MonteRun",
  description: "MonteRun Analytics Monte Carlo surface",
  openGraph: {
    title: "MonteRun",
    description: "MonteRun Analytics Monte Carlo surface",
    siteName: "MonteRun",
    type: "website",
    images: [
      {
        url: defaultOgImage,
        width: 1200,
        height: 630,
        alt: "MonteRun survival reality check card.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MonteRun",
    description: "MonteRun Analytics Monte Carlo surface",
    images: [defaultOgImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html className="dark" lang="en">
      <body className={`${inter.variable} min-h-screen bg-transparent text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}

