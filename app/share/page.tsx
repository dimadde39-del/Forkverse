import type { Metadata } from "next";
import Link from "next/link";

import {
  buildShareCardAlt,
  formatRunwayLabel,
  formatSurvivalLabel,
  getOgImagePath,
  getSharePagePath,
  normalizeShareCardPayload,
} from "@/app/lib/share-card";

type SharePageProps = {
  searchParams: Promise<{
    runway?: string | string[];
    survival?: string | string[];
    verdict?: string | string[];
  }>;
};

export async function generateMetadata({ searchParams }: SharePageProps): Promise<Metadata> {
  const shareCard = normalizeShareCardPayload(await searchParams);
  const sharePath = getSharePagePath(shareCard);
  const ogImagePath = getOgImagePath(shareCard);
  const title = `${shareCard.verdict} | MonteRun`;
  const description = `Runway ${formatRunwayLabel(shareCard.runway)}. Survival 12m ${formatSurvivalLabel(shareCard.survival)}.`;

  return {
    title,
    description,
    alternates: {
      canonical: sharePath,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: sharePath,
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

export default async function SharePage({ searchParams }: SharePageProps) {
  const shareCard = normalizeShareCardPayload(await searchParams);
  const ogImagePath = getOgImagePath(shareCard);

  return (
    <main className="min-h-screen bg-[#050608] px-6 py-16 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-[11px] uppercase tracking-[0.36em] text-cyan-200/74">MonteRun share page</p>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
              {shareCard.verdict}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-white/62 sm:text-base">
              Deterministic survival snapshot rendered for social previews through the live Satori OG endpoint.
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full border border-cyan-200/20 bg-cyan-300/10 px-5 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/14"
          >
            Run your own simulation
          </Link>
        </div>

        <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/45">Runway</p>
            <p className="text-3xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
              {formatRunwayLabel(shareCard.runway)}
            </p>
          </div>

          <div className="h-px w-full bg-white/8 sm:h-14 sm:w-px" />

          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/45">Survival 12m</p>
            <p className="text-3xl font-semibold tracking-[-0.05em] text-cyan-200 sm:text-5xl">
              {formatSurvivalLabel(shareCard.survival)}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0A0A0A]">
          <img
            alt={buildShareCardAlt(shareCard)}
            className="block h-auto w-full"
            height={630}
            src={ogImagePath}
            width={1200}
          />
        </div>

        <div className="flex flex-col gap-3 text-sm text-white/58">
          <p>Share URL</p>
          <code className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[12px] text-cyan-100/88">
            {getSharePagePath(shareCard)}
          </code>
        </div>
      </div>
    </main>
  );
}
