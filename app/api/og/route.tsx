import { ImageResponse } from "next/og";

export const runtime = "edge";

const FALLBACKS = {
  capital: 50_000,
  income: 0,
  burn: 10_000,
  survival: 0,
};

function readFiniteNumber(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const normalized = value.replace(/[$,%\s_]/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readSurvival(value: string | null) {
  const parsed = readFiniteNumber(value, FALLBACKS.survival);
  const asPercent = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.round(clamp(asPercent, 0, 100));
}

function readMoney(value: string | null, fallback: number) {
  return Math.max(0, readFiniteNumber(value, fallback));
}

function getRunwayMonths(capital: number, income: number, burn: number) {
  const monthlyDrain = Math.max(burn - income, 1);

  return Math.max(0, Math.floor(capital / monthlyDrain));
}

function formatRunway(months: number) {
  if (months >= 1_000) {
    return "999+";
  }

  return String(months);
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1).trimEnd()}...`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const capital = readMoney(searchParams.get("capital"), FALLBACKS.capital);
  const income = readMoney(searchParams.get("income"), FALLBACKS.income);
  const burn = readMoney(searchParams.get("burn"), FALLBACKS.burn);
  const survival = readSurvival(searchParams.get("survival"));
  const runwayMonths = getRunwayMonths(capital, income, burn);
  const runwayLabel = formatRunway(runwayMonths);
  const verdict = truncate(`My startup dies in ${runwayLabel} months. Beat that.`, 72);

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          backgroundColor: "#05070a",
          color: "#f4f8fb",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "58px 70px 54px",
            backgroundImage:
              "radial-gradient(circle at 86% 18%, rgba(100, 240, 255, 0.22), transparent 30%), linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 42%)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 18,
                  backgroundColor: "#70f6ff",
                  boxShadow: "0 0 34px rgba(112, 246, 255, 0.8)",
                }}
              />
              <div style={{ display: "flex" }}>MonteRun</div>
            </div>

            <div
              style={{
                display: "flex",
                color: "rgba(244, 248, 251, 0.58)",
                fontSize: 17,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
              }}
            >
              Deterministic runway card
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 28,
                width: "100%",
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "#70f6ff",
                  fontSize: 212,
                  fontWeight: 800,
                  lineHeight: 0.84,
                  letterSpacing: "-0.065em",
                }}
              >
                {survival}%
              </div>
              <div
                style={{
                  display: "flex",
                  paddingBottom: 18,
                  color: "rgba(244, 248, 251, 0.86)",
                  fontSize: 52,
                  fontWeight: 750,
                  lineHeight: 0.95,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                Survival
              </div>
            </div>

            <div
              style={{
                display: "flex",
                width: "840px",
                color: "#f4f8fb",
                fontSize: 54,
                fontWeight: 720,
                lineHeight: 1.04,
                letterSpacing: "-0.03em",
              }}
            >
              {verdict}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              borderTop: "1px solid rgba(244, 248, 251, 0.14)",
              paddingTop: 28,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 22,
                color: "rgba(244, 248, 251, 0.62)",
                fontSize: 20,
                letterSpacing: "0.04em",
              }}
            >
              <div style={{ display: "flex" }}>Capital ${Math.round(capital).toLocaleString("en-US")}</div>
              <div style={{ display: "flex", color: "rgba(244, 248, 251, 0.28)" }}>/</div>
              <div style={{ display: "flex" }}>Burn ${Math.round(burn).toLocaleString("en-US")}/mo</div>
              <div style={{ display: "flex", color: "rgba(244, 248, 251, 0.28)" }}>/</div>
              <div style={{ display: "flex" }}>Income ${Math.round(income).toLocaleString("en-US")}/mo</div>
            </div>

            <div
              style={{
                display: "flex",
                color: "#70f6ff",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              Math decides
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
