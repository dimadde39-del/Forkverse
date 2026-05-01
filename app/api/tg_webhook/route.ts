import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Single production Telegram webhook owner for the launch drift-alert flow.
const BOT_REPLY = "Plan fixed. I'll be back in 7 days to check how survival is going.";
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

type TelegramUser = {
  id?: unknown;
};

type TelegramChat = {
  id?: unknown;
};

type TelegramMessage = {
  text?: unknown;
  from?: TelegramUser;
  chat?: TelegramChat;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

type StartContext = {
  runwayMonths: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTelegramMessage(update: unknown): TelegramMessage | null {
  if (!isRecord(update)) {
    return null;
  }

  const body = isRecord(update.update) ? update.update : update;
  const message = body.message ?? body.edited_message;

  return isRecord(message) ? message : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function readStartParameter(text: unknown): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const [command, startParameter] = text.trim().split(/\s+/, 2);
  if (!command || !command.startsWith("/start")) {
    return null;
  }

  return startParameter?.trim() || null;
}

function parseRunwayStartToken(startParameter: string | null): StartContext | null {
  if (!startParameter?.startsWith("mr1_")) {
    return null;
  }

  const encodedTenths = startParameter.slice(4);
  if (!/^[0-9a-z]+$/i.test(encodedTenths)) {
    return null;
  }

  const runwayTenths = Number.parseInt(encodedTenths, 36);
  if (!Number.isFinite(runwayTenths) || runwayTenths < 0) {
    return null;
  }

  return {
    runwayMonths: Math.round((runwayTenths / 10) * 10) / 10,
  };
}

async function upsertUserAlert(telegramId: number, context: StartContext): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not configured");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/user_alerts?on_conflict=telegram_id`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        telegram_id: telegramId,
        last_runway_months: context.runwayMonths,
        created_at: new Date().toISOString(),
        last_pinged_at: null,
      },
    ]),
  });

  if (!response.ok) {
    throw new Error(`Supabase user_alerts upsert failed with HTTP ${response.status}`);
  }
}

async function sendTelegramReply(chatId: number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Telegram bot token is not configured");
  }

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: BOT_REPLY,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const message = readTelegramMessage(body);
    const startParameter = readStartParameter(message?.text);
    const context = parseRunwayStartToken(startParameter);
    const telegramId = readPositiveInteger(message?.from?.id);
    const chatId = readPositiveInteger(message?.chat?.id);

    if (telegramId && chatId && context) {
      await upsertUserAlert(telegramId, context);
      await sendTelegramReply(chatId);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[tg_webhook] start flow failed:", error);
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
