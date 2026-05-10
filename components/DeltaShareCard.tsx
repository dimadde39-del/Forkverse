"use client";

type DeltaShareCardProps = {
  deltaMonths: number;
};

function buildTweetText(formattedDelta: string): string {
  return `I just crash-tested my freelance budget. By cutting the fat, I bought myself +${formattedDelta} months of survival time.\n\nCrash-test your own money here: https://monterun.vercel.app`;
}

export default function DeltaShareCard({ deltaMonths }: DeltaShareCardProps) {
  const formattedDelta = deltaMonths.toFixed(1);
  const tweetText = buildTweetText(formattedDelta);
  const tweetIntentHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  if (deltaMonths <= 0) {
    return null;
  }

  return (
    <section
      aria-label="Delta Share Card"
      className="rounded-[18px] border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.16),rgba(5,5,5,0.92)_48%,rgba(255,255,255,0.045))] p-4 shadow-[inset_0_1px_0_rgba(236,253,245,0.08),0_18px_70px_rgba(16,185,129,0.12)] sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5"
    >
      <p className="min-w-0 text-base font-medium leading-7 text-white sm:text-lg">
        You bought yourself +{formattedDelta} months of survival time.
      </p>
      <a
        aria-label="Share to X"
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition hover:border-emerald-200/42 hover:bg-emerald-300/12 hover:text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-200/50 sm:mt-0 sm:shrink-0"
        href={tweetIntentHref}
        rel="noreferrer"
        target="_blank"
      >
        <span
          aria-hidden="true"
          className="grid h-5 w-5 place-items-center rounded-full border border-current text-[12px] leading-none"
        >
          X
        </span>
        <span>Share to X</span>
      </a>
    </section>
  );
}
