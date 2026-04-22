import { ImageResponse } from "next/og";

import {
  clampText,
  formatRunwayLabel,
  formatSurvivalLabel,
  normalizeShareCardPayload,
} from "@/app/lib/share-card";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shareCard = normalizeShareCardPayload({
    runway: searchParams.get("runway") ?? undefined,
    survival: searchParams.get("survival") ?? undefined,
    verdict: searchParams.get("verdict") ?? undefined,
  });
  const verdict = clampText(shareCard.verdict, 110) || shareCard.verdict;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: "36px",
          backgroundColor: "#0A0A0A",
          backgroundImage:
            "radial-gradient(circle at top right, rgba(157, 244, 255, 0.14), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
          color: "#f5f7fa",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "40px",
            borderRadius: "34px",
            border: "1px solid rgba(255,255,255,0.09)",
            backgroundColor: "#0A0A0A",
            backgroundImage:
              "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01)), radial-gradient(circle at top right, rgba(173, 242, 255, 0.08), transparent 28%)",
            boxShadow: "0 32px 90px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                textTransform: "uppercase",
                letterSpacing: "0.34em",
                fontSize: "18px",
                color: "rgba(255,255,255,0.84)",
              }}
            >
              <div
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "999px",
                  backgroundColor: "#9df4ff",
                  boxShadow: "0 0 32px rgba(157, 244, 255, 0.4)",
                }}
              />
              <span>MonteRun</span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 16px",
                borderRadius: "999px",
                border: "1px solid rgba(157, 244, 255, 0.22)",
                color: "#9df4ff",
                backgroundColor: "rgba(157, 244, 255, 0.06)",
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                fontSize: "15px",
              }}
            >
              Deterministic share card
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "28px",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "24px",
                alignItems: "stretch",
              }}
            >
              <div
                style={{
                  flex: "1 1 0%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "18px",
                  padding: "28px",
                  borderRadius: "26px",
                  backgroundColor: "#0f1114",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: "17px",
                    textTransform: "uppercase",
                    letterSpacing: "0.26em",
                    color: "rgba(255,255,255,0.52)",
                  }}
                >
                  Runway
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      fontSize: "136px",
                      lineHeight: "0.9",
                      letterSpacing: "-0.08em",
                      fontWeight: 700,
                    }}
                  >
                    {formatRunwayLabel(shareCard.runway).replace("m", "")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      paddingBottom: "14px",
                      fontSize: "24px",
                      letterSpacing: "0.24em",
                      textTransform: "uppercase",
                      color: "#9df4ff",
                    }}
                  >
                    Months
                  </div>
                </div>
              </div>

              <div
                style={{
                  width: "330px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "18px",
                  padding: "28px",
                  borderRadius: "26px",
                  backgroundColor: "#10151a",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: "17px",
                    textTransform: "uppercase",
                    letterSpacing: "0.26em",
                    color: "rgba(255,255,255,0.52)",
                  }}
                >
                  Survival 12m
                </div>

                <div
                  style={{
                    display: "flex",
                    fontSize: "74px",
                    lineHeight: "0.92",
                    letterSpacing: "-0.06em",
                    fontWeight: 700,
                    color: "#9df4ff",
                  }}
                >
                  {formatSurvivalLabel(shareCard.survival)}
                </div>

                <div
                  style={{
                    display: "flex",
                    fontSize: "18px",
                    lineHeight: "1.5",
                    color: "rgba(255,255,255,0.58)",
                  }}
                >
                  Real math. Zero motivational padding.
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                padding: "28px",
                borderRadius: "26px",
                backgroundColor: "#0f1114",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: "17px",
                  textTransform: "uppercase",
                  letterSpacing: "0.26em",
                  color: "rgba(255,255,255,0.52)",
                }}
              >
                Verdict
              </div>

              <div
                style={{
                  display: "flex",
                  maxWidth: "920px",
                  fontSize: "48px",
                  lineHeight: "1.12",
                  letterSpacing: "-0.04em",
                  fontWeight: 600,
                }}
              >
                {verdict}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "20px",
              fontSize: "17px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.38)",
            }}
          >
            <div style={{ display: "flex" }}>monterun.io</div>
            <div style={{ display: "flex", color: "#9df4ff" }}>Math decides</div>
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
