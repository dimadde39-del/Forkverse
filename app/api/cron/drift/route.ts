export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIFT_ALERT_TEXT =
  "It's been a week. Is your startup still alive? Update your numbers.";

type UserAlertRow = {
  telegram_id: number;
  last_runway_months: number | null;
};

type CronStats = {
  candidates: number;
  sent: number;
  failed: number;
};

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function getSupabaseHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
}

async function fetchDueAlerts(
  supabaseUrl: string,
  serviceRoleKey: string,
  cutoffIso: string,
) {
  const url = new URL("/rest/v1/user_alerts", supabaseUrl);
  url.searchParams.set("select", "telegram_id,last_runway_months");
  url.searchParams.set("created_at", `lt.${cutoffIso}`);
  url.searchParams.set("last_pinged_at", "is.null");
  url.searchParams.set("order", "created_at.asc");

  const response = await fetch(url, {
    headers: getSupabaseHeaders(serviceRoleKey),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Supabase select failed with ${response.status}`);
  }

  return (await response.json()) as UserAlertRow[];
}

async function sendTelegramMessage(botToken: string, telegramId: number) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: telegramId,
        text: DRIFT_ALERT_TEXT,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with ${response.status}`);
  }
}

async function markPinged(
  supabaseUrl: string,
  serviceRoleKey: string,
  telegramId: number,
  pingedAtIso: string,
) {
  const url = new URL("/rest/v1/user_alerts", supabaseUrl);
  url.searchParams.set("telegram_id", `eq.${telegramId}`);
  url.searchParams.set("last_pinged_at", "is.null");

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...getSupabaseHeaders(serviceRoleKey),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      last_pinged_at: pingedAtIso,
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase update failed with ${response.status}`);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let supabaseUrl: string;
  let serviceRoleKey: string;
  let botToken: string;

  try {
    supabaseUrl = getRequiredEnv("SUPABASE_URL");
    serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    botToken = getRequiredEnv("TELEGRAM_BOT_TOKEN");
  } catch {
    return jsonResponse({ error: "Cron is not configured" }, 500);
  }

  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stats: CronStats = {
    candidates: 0,
    sent: 0,
    failed: 0,
  };

  try {
    const dueAlerts = await fetchDueAlerts(supabaseUrl, serviceRoleKey, cutoffIso);
    stats.candidates = dueAlerts.length;

    for (const alert of dueAlerts) {
      try {
        await sendTelegramMessage(botToken, alert.telegram_id);
        await markPinged(
          supabaseUrl,
          serviceRoleKey,
          alert.telegram_id,
          new Date().toISOString(),
        );
        stats.sent += 1;
      } catch {
        stats.failed += 1;
      }
    }

    return jsonResponse({
      data: stats,
      error: null,
    });
  } catch {
    return jsonResponse(
      {
        data: stats,
        error: "Drift alert cron failed",
      },
      500,
    );
  }
}
