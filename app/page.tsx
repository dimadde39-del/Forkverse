import type { Metadata } from "next";

import {
  buildShareCardAlt,
  formatRunwayLabel,
  formatSurvivalLabel,
  getShareLabels,
  getOgImagePath,
  hasShareResultParams,
  normalizeShareCardPayload,
} from "@/app/lib/share-card";

import SimulatorClient from "../components/SimulatorClient";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const resolvedSearchParams = await searchParams;

  if (!hasShareResultParams(resolvedSearchParams)) {
    const title = "MonteRun | Cash runway intelligence";
    const description = "Deterministic runway and survival estimates from explicit cash, income, burn, and delay inputs.";

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
            url: "/api/og",
            width: 1200,
            height: 630,
            alt: "MonteRun cash runway intelligence.",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: ["/api/og"],
      },
    };
  }

  const shareCard = normalizeShareCardPayload(resolvedSearchParams);
  const labels = getShareLabels(shareCard.language);
  const ogImagePath = getOgImagePath(shareCard);
  const title = `${formatSurvivalLabel(shareCard.survival)} ${labels.survival12m} | MonteRun`;
  const description = `${labels.runway} ${formatRunwayLabel(shareCard.runway)}. ${shareCard.verdict}`;

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
