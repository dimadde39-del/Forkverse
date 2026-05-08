import type { Metadata } from "next";
import Link from "next/link";

import {
  buildShareCardAlt,
  formatRunwayLabel,
  formatSurvivalLabel,
  getShareLabels,
  getOgImagePath,
  getSharePagePath,
  hasShareResultParams,
  normalizeShareCardPayload,
} from "@/app/lib/share-card";

const ENGLISH_FINANCIAL_GUARDRAIL = "Simulation estimate, not financial advice.";

type SharePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatMonths(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export async function generateMetadata({ searchParams }: SharePageProps): Promise<Metadata> {
  const resolvedSearchParams = await searchParams;
  if (!hasShareResultParams(resolvedSearchParams)) {
    const title = "MonteRun shared result";
    const description = "No MonteRun result was loaded from this share URL.";

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
            alt: "MonteRun share URL without a loaded result.",
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
  const sharePath = getSharePagePath(shareCard);
  const ogImagePath = getOgImagePath(shareCard);
  const title = `${shareCard.verdict} | MonteRun`;
  const description = `${labels.runway} ${formatRunwayLabel(shareCard.runway)}. ${labels.survival12m} ${formatSurvivalLabel(shareCard.survival)}.`;

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
  const resolvedSearchParams = await searchParams;
  if (!hasShareResultParams(resolvedSearchParams)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050608] px-6 py-16 text-white">
        <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
          <p className="text-[11px] uppercase tracking-[0.36em] text-cyan-200/74">MonteRun share page</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">No shared result loaded</h1>
          <p className="mt-4 text-sm leading-7 text-white/62">
            This URL does not contain runway, survival, and verdict fields from a MonteRun run.
          </p>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-cyan-200/20 bg-cyan-300/10 px-5 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/14"
            href="/"
          >
            Run your own simulation
          </Link>
        </div>
      </main>
    );
  }

  const shareCard = normalizeShareCardPayload(resolvedSearchParams);
  const labels = getShareLabels(shareCard.language);
  const ogImagePath = getOgImagePath(shareCard);
  const hasDelta = shareCard.baselineRunway !== null && shareCard.baselineSurvival !== null;
  const deltaRunwayMonths = hasDelta ? shareCard.runway - shareCard.baselineRunway! : 0;
  const isImprovement = deltaRunwayMonths >= 0;

  return (
    <main className="min-h-screen bg-[#050608] px-6 py-16 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] sm:p-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-[11px] uppercase tracking-[0.36em] text-cyan-200/74">{labels.sharePageEyebrow}</p>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
              {shareCard.verdict}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-white/62 sm:text-base">
              {labels.sharePageDescription}
            </p>
            <p className="text-xs text-white/42">{labels.guardrail || ENGLISH_FINANCIAL_GUARDRAIL}</p>
          </div>

          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full border border-cyan-200/20 bg-cyan-300/10 px-5 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/14"
          >
            {labels.sharePageCta}
          </Link>
        </div>

        <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/45">{labels.runway}</p>
            <div className="flex flex-wrap items-baseline gap-3">
              <p className="text-3xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                {formatRunwayLabel(shareCard.runway)}
              </p>
              {hasDelta ? (
                <span
                  className={`rounded-full border px-3 py-1 font-mono text-sm font-bold ${
                    isImprovement
                      ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"
                      : "border-orange-300/40 bg-orange-300/10 text-orange-200"
                  }`}
                >
                  {isImprovement ? labels.up : labels.down} {deltaRunwayMonths > 0 ? "+" : ""}
                  {formatMonths(deltaRunwayMonths)}
                </span>
              ) : null}
            </div>
            {hasDelta ? (
              <p className="text-sm text-white/42">
                {labels.baselinePrefix} {formatMonths(shareCard.baselineRunway!)} {labels.monthsUnit.toLowerCase()}
              </p>
            ) : null}
          </div>

          <div className="h-px w-full bg-white/8 sm:h-14 sm:w-px" />

          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/45">{labels.survival12m}</p>
            <p className="text-3xl font-semibold tracking-[-0.05em] text-cyan-200 sm:text-5xl">
              {hasDelta ? (
                <>
                  <span className="text-white/42">{formatSurvivalLabel(shareCard.baselineSurvival!)}</span>
                  <span className="px-2 text-white/30">{"->"}</span>
                </>
              ) : null}
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
          <p>{labels.shareUrl}</p>
          <code className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[12px] text-cyan-100/88">
            {getSharePagePath(shareCard)}
          </code>
        </div>
      </div>
    </main>
  );
}
