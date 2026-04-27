import type { Metadata } from "next";

import {
  buildShareCardAlt,
  formatRunwayLabel,
  formatSurvivalLabel,
  getOgImagePath,
  normalizeShareCardPayload,
} from "@/app/lib/share-card";

import SimulatorClient from "../components/SimulatorClient";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const shareCard = normalizeShareCardPayload(await searchParams);
  const ogImagePath = getOgImagePath(shareCard);
  const title = `${formatSurvivalLabel(shareCard.survival)} survival | MonteRun`;
  const description = `Runway ${formatRunwayLabel(shareCard.runway)}. ${shareCard.verdict}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "MonteRun",
      images: [
        {
          url: ogImagePath,
          width: 1200,
          height: 630,
          alt: buildShareCardAlt(shareCard),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImagePath],
    },
  };
}

export default function Page() {
  return (
    <main className="min-h-screen">
      <SimulatorClient />
    </main>
  );
}
