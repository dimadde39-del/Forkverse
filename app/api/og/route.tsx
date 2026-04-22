import { ImageResponse } from "next/og";

import { formatRunwayLabel, formatSurvivalLabel, normalizeShareCardPayload } from "@/app/lib/share-card";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shareCard = normalizeShareCardPayload({
    runway: searchParams.get("runway") ?? undefined,
    survival: searchParams.get("survival") ?? undefined,
    verdict: searchParams.get("verdict") ?? undefined,
  });
  const verdict = shareCard.verdict;
  const truncatedVerdict = verdict.length > 130 ? verdict.substring(0, 130) + '...' : verdict;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "center",
          padding: 32,
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
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 56,
            borderRadius: 34,
            border: "1px solid rgba(255,255,255,0.09)",
            backgroundColor: "#0A0A0A",
            backgroundImage:
              "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01)), radial-gradient(circle at top right, rgba(173, 242, 255, 0.08), transparent 28%)",
            boxShadow: "0 32px 90px rgba(0, 0, 0, 0.5)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                textTransform: "uppercase",
                letterSpacing: "0.34em",
                fontSize: 18,
                color: "rgba(255,255,255,0.84)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  backgroundColor: "#9df4ff",
                  boxShadow: "0 0 32px rgba(157, 244, 255, 0.4)",
                }}
              />
              <div style={{ display: "flex" }}>MonteRun</div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                paddingLeft: 18,
                paddingRight: 18,
                height: 46,
                borderRadius: 999,
                border: "1px solid rgba(157, 244, 255, 0.22)",
                color: "#9df4ff",
                backgroundColor: "rgba(157, 244, 255, 0.06)",
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              Deterministic share card
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 36,
              flex: 1,
              marginTop: 36,
              marginBottom: 36,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "stretch",
                justifyContent: "space-between",
                gap: 36,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flex: "1 1 0%",
                  width: "52%",
                  minWidth: 0,
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 28,
                  padding: 36,
                  borderRadius: 26,
                  backgroundColor: "#0f1114",
                  border: "1px solid rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    fontSize: 17,
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
                    gap: 18,
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      fontSize: 138,
                      lineHeight: 0.88,
                      letterSpacing: "-0.08em",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {formatRunwayLabel(shareCard.runway).replace("m", "")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      paddingBottom: 14,
                      fontSize: 24,
                      letterSpacing: "0.24em",
                      textTransform: "uppercase",
                      color: "#9df4ff",
                      flexShrink: 0,
                    }}
                  >
                    Months
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flex: "1 1 0%",
                  width: "44%",
                  minWidth: 0,
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 24,
                  padding: 36,
                  borderRadius: 26,
                  backgroundColor: "#10151a",
                  border: "1px solid rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    fontSize: 17,
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
                    width: "100%",
                    fontSize: 74,
                    lineHeight: 0.92,
                    letterSpacing: "-0.06em",
                    fontWeight: 700,
                    color: "#9df4ff",
                    flexShrink: 0,
                  }}
                >
                  {formatSurvivalLabel(shareCard.survival)}
                </div>

                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    fontSize: 18,
                    lineHeight: 1.5,
                    color: "rgba(255,255,255,0.58)",
                    flexWrap: "wrap",
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
                justifyContent: "space-between",
                gap: 22,
                padding: 36,
                borderRadius: 26,
                backgroundColor: "#0f1114",
                border: "1px solid rgba(255,255,255,0.07)",
                overflow: "hidden",
                flex: 1,
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  fontSize: 17,
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
                  width: "100%",
                  flexWrap: "wrap",
                  overflow: "hidden",
                  alignItems: "flex-start",
                  alignContent: "flex-start",
                  fontSize: 46,
                  lineHeight: 1.14,
                  letterSpacing: "-0.04em",
                  fontWeight: 600,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    flexWrap: "wrap",
                    overflow: "hidden",
                  }}
                >
                  {truncatedVerdict}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
              fontSize: 17,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.38)",
              flexShrink: 0,
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
