import { ImageResponse } from "next/og";

import { formatRunwayLabel, getShareLabels, type ShareLanguage } from "@/app/lib/share-card";

export const runtime = "edge";

const FALLBACKS = {
  survival: 0,
  runway: 0,
};
const OG_VERDICT_MAX_CHARS = 72;
const FINANCIAL_GUARDRAIL = "Simulation estimate, not financial advice.";
const URL_SNAPSHOT_NOTE = "URL snapshot, not a verified record.";
const URL_SNAPSHOT_NOTE_RU = "\u0421\u043d\u0438\u043c\u043e\u043a \u0438\u0437 URL, \u043d\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043d\u0430\u044f \u0437\u0430\u043f\u0438\u0441\u044c.";

function readFiniteNumber(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const normalized = value.replace(/[$,%\s_]/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalFiniteNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[$,%\s_]/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readSurvival(value: string | null) {
  const parsed = readFiniteNumber(value, FALLBACKS.survival);
  const asPercent = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.round(clamp(asPercent, 0, 100));
}

function readLanguage(value: string | null): ShareLanguage {
  return value === "ru" ? "ru" : "en";
}

function readOptionalSurvival(value: string | null) {
  const parsed = readOptionalFiniteNumber(value);

  if (parsed === null) {
    return null;
  }

  const asPercent = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;

  return Math.round(clamp(asPercent, 0, 100));
}

function readMoney(value: string | null, fallback: number) {
  return Math.max(0, readFiniteNumber(value, fallback));
}

function readOptionalRunway(value: string | null) {
  const parsed = readOptionalFiniteNumber(value);

  return parsed === null ? null : Math.max(0, parsed);
}

function readRunway(value: string | null, fallback: number) {
  return readOptionalRunway(value) ?? fallback;
}

function deriveRunwayMonths(capital: number, income: number, burn: number) {
  const monthlyDrain = Math.max(burn - income, 1);

  return Math.max(0, capital / monthlyDrain);
}

function formatRunway(months: number) {
  return formatRunwayLabel(months);
}

function formatMonths(months: number) {
  const rounded = Math.round(months * 10) / 10;

  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getDeltaVerdict(baselineSurvival: number, deltaRunwayMonths: number, language: ShareLanguage) {
  if (language === "ru") {
    if (deltaRunwayMonths > 0) {
      return `\u0411\u044b\u043b\u043e ${baselineSurvival}%. \u0417\u0430\u043f\u0430\u0441 \u0432\u044b\u0440\u043e\u0441 \u043d\u0430 ${formatMonths(deltaRunwayMonths)} \u043c\u0435\u0441.`;
    }

    if (deltaRunwayMonths < 0) {
      return `\u0411\u044b\u043b\u043e ${baselineSurvival}%. \u0417\u0430\u043f\u0430\u0441 \u0443\u043f\u0430\u043b \u043d\u0430 ${formatMonths(Math.abs(deltaRunwayMonths))} \u043c\u0435\u0441.`;
    }

    return `\u0411\u044b\u043b\u043e ${baselineSurvival}%. \u0417\u0430\u043f\u0430\u0441 \u043d\u0435 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0441\u044f.`;
  }

  if (deltaRunwayMonths > 0) {
    return `Was ${baselineSurvival}%. Gained ${formatMonths(deltaRunwayMonths)} months.`;
  }

  if (deltaRunwayMonths < 0) {
    return `Was ${baselineSurvival}%. Lost ${formatMonths(Math.abs(deltaRunwayMonths))} months.`;
  }

  return `Was ${baselineSurvival}%. Runway unchanged.`;
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1).trimEnd()}...`;
}

function sanitizeText(value: string | null, fallback: string, limit: number) {
  if (!value) {
    return fallback;
  }

  const normalized = value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? truncate(normalized, limit) : fallback;
}

function hasResultParams(searchParams: URLSearchParams) {
  const runway = readOptionalRunway(searchParams.get("runway"));
  const survival = readOptionalSurvival(searchParams.get("survival"));
  const verdict = sanitizeText(searchParams.get("verdict"), "", OG_VERDICT_MAX_CHARS);

  return runway !== null && survival !== null && verdict.length > 0;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const language = readLanguage(searchParams.get("language") ?? searchParams.get("lang"));
  const labels = getShareLabels(language);

  if (!hasResultParams(searchParams)) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backgroundColor: "#05070a",
            color: "#f4f8fb",
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            padding: "58px 70px 54px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 22, fontWeight: 700 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 18,
                backgroundColor: "#70f6ff",
                boxShadow: "0 0 34px rgba(112, 246, 255, 0.8)",
              }}
            />
            <div style={{ display: "flex", letterSpacing: "0.12em", textTransform: "uppercase" }}>MonteRun</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", color: "#70f6ff", fontSize: 54, fontWeight: 800 }}>
              No shared result loaded
            </div>
            <div style={{ display: "flex", width: "780px", color: "rgba(244,248,251,0.68)", fontSize: 34 }}>
              Run a scenario to create a MonteRun runway snapshot.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "1px solid rgba(244, 248, 251, 0.14)",
              paddingTop: 28,
              color: "rgba(244, 248, 251, 0.58)",
              fontSize: 18,
            }}
          >
            <div style={{ display: "flex" }}>{FINANCIAL_GUARDRAIL}</div>
            <div style={{ display: "flex", color: "#70f6ff", fontWeight: 700, letterSpacing: "0.18em" }}>
              Math decides
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

  const survival = readSurvival(searchParams.get("survival"));
  const baselineRunway = readOptionalRunway(searchParams.get("baselineRunway"));
  const baselineSurvival = readOptionalSurvival(searchParams.get("baselineSurvival"));
  const runwayMonths = readRunway(searchParams.get("runway"), FALLBACKS.runway);
  const runwayLabel = formatRunway(runwayMonths);
  const hasDelta = baselineRunway !== null && baselineSurvival !== null;
  const deltaRunwayMonths = hasDelta ? runwayMonths - baselineRunway : 0;
  const isImprovement = deltaRunwayMonths >= 0;
  const accentColor = hasDelta ? (isImprovement ? "#70f6ff" : "#ff8b5f") : "#70f6ff";
  const fallbackVerdict = hasDelta
    ? getDeltaVerdict(baselineSurvival, deltaRunwayMonths, language)
    : language === "ru"
      ? `\u041c\u043e\u0439 \u0431\u0438\u0437\u043d\u0435\u0441 \u0443\u043c\u0438\u0440\u0430\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 ${runwayLabel}. \u041f\u0440\u043e\u0432\u0435\u0440\u044c \u0441\u0432\u043e\u0439.`
      : `My startup dies in ${runwayLabel}. Beat that.`;
  const verdict = sanitizeText(
    searchParams.get("verdict"),
    fallbackVerdict,
    OG_VERDICT_MAX_CHARS,
  );

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
              {labels.ogCardLabel}
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
                gap: hasDelta ? 24 : 28,
                width: "100%",
              }}
            >
              {hasDelta ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 28,
                    color: accentColor,
                    fontSize: 126,
                    fontWeight: 800,
                    lineHeight: 0.9,
                    letterSpacing: "0",
                  }}
                >
                  <span style={{ display: "flex", color: "rgba(244, 248, 251, 0.58)" }}>
                    {baselineSurvival}%
                  </span>
                  <span
                    style={{
                      display: "flex",
                      color: "rgba(244, 248, 251, 0.34)",
                      fontSize: 82,
                      letterSpacing: "0",
                    }}
                  >
                    {"->"}
                  </span>
                  <span style={{ display: "flex" }}>{survival}%</span>
                </div>
              ) : (
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
              )}
              <div
                style={{
                  display: "flex",
                  paddingBottom: hasDelta ? 12 : 18,
                  color: "rgba(244, 248, 251, 0.86)",
                  fontSize: hasDelta ? 42 : 52,
                  fontWeight: 750,
                  lineHeight: 0.95,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                {hasDelta ? labels.survival12m : labels.survivalMetric.replace(" Probability 12m", "")}
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
              <div style={{ display: "flex" }}>
                {labels.runway} {runwayLabel}
              </div>
              <div style={{ display: "flex", color: "rgba(244, 248, 251, 0.28)" }}>/</div>
              <div style={{ display: "flex" }}>
                {labels.survival12m} {survival}%
              </div>
              <div style={{ display: "flex", color: "rgba(244, 248, 251, 0.28)" }}>/</div>
              <div style={{ display: "flex" }}>{language === "en" ? URL_SNAPSHOT_NOTE : URL_SNAPSHOT_NOTE_RU}</div>
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
              {labels.mathDecides}
            </div>
            <div
              style={{
                display: "flex",
                color: "rgba(244, 248, 251, 0.46)",
                fontSize: 17,
                letterSpacing: "0.02em",
              }}
            >
              {language === "en" ? FINANCIAL_GUARDRAIL : labels.guardrail}
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
