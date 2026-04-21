from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from io import BytesIO
from typing import Any, Final

import matplotlib

matplotlib.use("Agg", force=True)

import matplotlib.pyplot as plt
import numpy as np
import requests
from matplotlib.ticker import FuncFormatter

from api import parse as parse_api


SCHEMA_VERSION: Final[str] = "2026-04"
MAX_PAYLOAD_BYTES: Final[int] = 1_000_000
TELEGRAM_TIMEOUT_SECONDS: Final[float] = 20.0
TELEGRAM_API_BASE_URL: Final[str] = "https://api.telegram.org"
BOT_TOKEN_ENV: Final[str] = "TELEGRAM_BOT_TOKEN"
MAX_SPAGHETTI_LINES: Final[int] = 50
PNG_DPI: Final[int] = 160
FIGURE_SIZE: Final[tuple[float, float]] = (10.8, 6.4)

BACKGROUND_COLOR: Final[str] = "#050816"
PANEL_COLOR: Final[str] = "#0d1321"
GRID_COLOR: Final[str] = "#9ca3af"
SPINE_COLOR: Final[str] = "#334155"
TEXT_COLOR: Final[str] = "#e5eefb"
MUTED_TEXT_COLOR: Final[str] = "#94a3b8"
SPAGHETTI_COLOR: Final[str] = "#d1fae5"
P10_COLOR: Final[str] = "#34d399"
P50_COLOR: Final[str] = "#10b981"
P90_COLOR: Final[str] = "#99f6e4"
BAND_COLOR: Final[str] = "#10b981"
BANKRUPTCY_COLOR: Final[str] = "#ef4444"

LOGGER = logging.getLogger(__name__)
ApiProblem = parse_api.ApiProblem


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _build_meta(request_id: str, started_at: float) -> dict[str, Any]:
    elapsed_ms = round((time.perf_counter() - started_at) * 1000)
    return {
        "schema_version": SCHEMA_VERSION,
        "simulation_time_ms": elapsed_ms,
        "request_id": request_id,
        "generated_at": _utc_now_iso(),
    }


def _build_error(
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details,
        "retryable": retryable,
    }


def _coerce_positive_int(field: str, value: Any) -> int:
    if isinstance(value, bool):
        raise ApiProblem("INVALID_PARAMS", f"{field} must be a positive integer", {"field": field}, False)

    if isinstance(value, int):
        coerced = value
    elif isinstance(value, float):
        if not value.is_integer():
            raise ApiProblem("INVALID_PARAMS", f"{field} must be a positive integer", {"field": field}, False)
        coerced = int(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            raise ApiProblem("INVALID_PARAMS", f"{field} must be a positive integer", {"field": field}, False)
        try:
            coerced = int(stripped)
        except ValueError as exc:
            raise ApiProblem("INVALID_PARAMS", f"{field} must be a positive integer", {"field": field}, False) from exc
    else:
        raise ApiProblem("INVALID_PARAMS", f"{field} must be a positive integer", {"field": field}, False)

    if coerced <= 0:
        raise ApiProblem("INVALID_PARAMS", f"{field} must be a positive integer", {"field": field}, False)

    return coerced


def _require_bot_token() -> str:
    try:
        token = os.environ[BOT_TOKEN_ENV].strip()
    except KeyError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Telegram bot token is not configured",
            {"env": BOT_TOKEN_ENV},
            False,
        ) from exc

    if not token:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Telegram bot token is not configured",
            {"env": BOT_TOKEN_ENV},
            False,
        )

    return token


def _escape_markdown_v2(value: str) -> str:
    escaped = value
    for character in ("\\", "_", "*", "[", "]", "(", ")", "~", "`", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!"):
        escaped = escaped.replace(character, f"\\{character}")
    return escaped


def _format_currency(value: float) -> str:
    rounded = int(round(value))
    sign = "-" if rounded < 0 else ""
    absolute = abs(rounded)
    return f"{sign}{absolute:,} ₸".replace(",", " ")


def _format_axis_currency(value: float, _position: int) -> str:
    absolute = abs(value)
    sign = "-" if value < 0 else ""

    if absolute >= 1_000_000:
        compact = absolute / 1_000_000
        formatted = f"{compact:.1f}M" if absolute < 10_000_000 else f"{compact:.0f}M"
        return f"{sign}{formatted}"

    if absolute >= 1_000:
        compact = absolute / 1_000
        formatted = f"{compact:.1f}k" if absolute < 100_000 else f"{compact:.0f}k"
        return f"{sign}{formatted}"

    return f"{sign}{int(round(absolute))}"


def _extract_message(update: Mapping[str, Any]) -> Mapping[str, Any]:
    for field in ("message", "edited_message"):
        candidate = update.get(field)
        if isinstance(candidate, Mapping):
            return candidate

    raise ApiProblem(
        "INVALID_PARAMS",
        "Telegram update does not contain a supported message",
        {"supported_update_types": ["message", "edited_message"]},
        False,
    )


def _extract_message_text(message: Mapping[str, Any]) -> str:
    text = message.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ApiProblem(
            "INVALID_PARAMS",
            "Telegram message text is required",
            {"field": "message.text"},
            False,
        )

    return text.strip()


def _extract_chat_id(message: Mapping[str, Any]) -> int:
    chat = message.get("chat")
    if not isinstance(chat, Mapping):
        raise ApiProblem("INVALID_PARAMS", "Telegram chat payload is missing", {"field": "message.chat"}, False)

    return _coerce_positive_int("message.chat.id", chat.get("id"))


def _extract_telegram_user_id(message: Mapping[str, Any]) -> int:
    sender = message.get("from")
    if not isinstance(sender, Mapping):
        raise ApiProblem("INVALID_PARAMS", "Telegram sender payload is missing", {"field": "message.from"}, False)

    return _coerce_positive_int("message.from.id", sender.get("id"))


def _extract_first_name(message: Mapping[str, Any]) -> str | None:
    sender = message.get("from")
    if not isinstance(sender, Mapping):
        return None

    first_name = sender.get("first_name")
    return first_name.strip() if isinstance(first_name, str) and first_name.strip() else None


def _process_parse_flow(user_text: str, telegram_user_id: int, request_id: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
    parser_context_payload, telegram_context_row, scenario_state_row = parse_api._load_telegram_parser_context(telegram_user_id)
    parser_input = parse_api._build_parser_input(user_text, parser_context_payload)
    parsed = parse_api._call_groq(
        parser_input,
        base_params=parse_api._extract_base_params_snapshot(parser_context_payload),
    )

    if parsed.get("status") != "ready":
        parse_api._persist_last_bot_question(
            telegram_user_id=telegram_user_id,
            request_id=request_id,
            source_text=user_text,
            question=parsed.get("question") if isinstance(parsed, Mapping) else None,
            telegram_context_row=telegram_context_row,
            scenario_state_row=scenario_state_row,
        )
        return parsed, None

    params = parsed.get("params")
    if not isinstance(params, Mapping):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": "params"},
            False,
        )

    trajectories = parse_api._run_simulation(
        params["initial_capital"],
        params["monthly_income"],
        params["monthly_burn"],
        months=params["months"],
        n_simulations=params["n_simulations"],
        income_delay_months=params.get("income_delay_months", 0),
    )
    simulation_data = parse_api._build_simulation_response(trajectories)
    parse_api._persist_scenario_state(
        telegram_user_id=telegram_user_id,
        request_id=request_id,
        source_text=user_text,
        params=params,
        simulation_data=simulation_data,
        telegram_context_row=telegram_context_row,
        scenario_state_row=scenario_state_row,
    )

    return parsed, simulation_data


def _render_simulation_png(simulation_data: Mapping[str, Any]) -> BytesIO:
    months = np.asarray(simulation_data.get("months"), dtype=np.float64)
    p10 = np.asarray(simulation_data.get("p10"), dtype=np.float64)
    p50 = np.asarray(simulation_data.get("p50"), dtype=np.float64)
    p90 = np.asarray(simulation_data.get("p90"), dtype=np.float64)
    spaghetti = np.asarray(simulation_data.get("spaghetti_sample"), dtype=np.float64)

    if months.ndim != 1 or p10.shape != months.shape or p50.shape != months.shape or p90.shape != months.shape:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Simulation result is malformed",
            {"field": "simulation_data"},
            False,
        )

    if spaghetti.ndim == 1:
        spaghetti = spaghetti[np.newaxis, :]
    elif spaghetti.ndim != 2:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Simulation result is malformed",
            {"field": "spaghetti_sample"},
            False,
        )

    figure, axis = plt.subplots(figsize=FIGURE_SIZE, dpi=PNG_DPI)
    figure.patch.set_facecolor(BACKGROUND_COLOR)
    axis.set_facecolor(PANEL_COLOR)

    sample_count = min(int(spaghetti.shape[0]), MAX_SPAGHETTI_LINES)
    for path in spaghetti[:sample_count]:
        if path.shape != months.shape:
            continue
        axis.plot(months, path, color=SPAGHETTI_COLOR, linewidth=1.0, alpha=0.1, zorder=1)

    axis.fill_between(months, p10, p90, color=BAND_COLOR, alpha=0.12, zorder=2)
    axis.plot(months, p90, color=P90_COLOR, linewidth=2.1, linestyle=(0, (5, 4)), zorder=3)
    axis.plot(months, p50, color=P50_COLOR, linewidth=2.8, zorder=4)
    axis.plot(months, p10, color=P10_COLOR, linewidth=2.1, linestyle=(0, (5, 4)), zorder=3)
    axis.axhline(0.0, color=BANKRUPTCY_COLOR, linewidth=1.8, linestyle="--", zorder=2)

    axis.grid(color=GRID_COLOR, alpha=0.12, linewidth=0.8)
    axis.set_title("MonteRun Monte Carlo", color=TEXT_COLOR, fontsize=15, pad=12)
    axis.text(
        0.01,
        0.97,
        "50 spaghetti · P10 / P50 / P90 · bankruptcy line",
        transform=axis.transAxes,
        color=MUTED_TEXT_COLOR,
        fontsize=9,
        va="top",
    )
    axis.set_xlabel("Month", color=MUTED_TEXT_COLOR)
    axis.set_ylabel("Capital", color=MUTED_TEXT_COLOR)
    axis.tick_params(colors=MUTED_TEXT_COLOR, labelsize=9)
    axis.yaxis.set_major_formatter(FuncFormatter(_format_axis_currency))

    for spine in axis.spines.values():
        spine.set_color(SPINE_COLOR)

    figure.tight_layout()

    png_buffer = BytesIO()
    try:
        figure.savefig(
            png_buffer,
            format="png",
            dpi=PNG_DPI,
            bbox_inches="tight",
            facecolor=BACKGROUND_COLOR,
        )
        png_buffer.seek(0)
        return png_buffer
    finally:
        plt.close(figure)


def _build_ready_caption(first_name: str | None, params: Mapping[str, Any], simulation_data: Mapping[str, Any]) -> str:
    survival_probability = float(simulation_data["survival_probability"]) * 100.0
    p10 = float(simulation_data["p10"][-1])
    p50 = float(simulation_data["p50"][-1])
    p90 = float(simulation_data["p90"][-1])
    months = int(params["months"])
    delay_months = int(params.get("income_delay_months", 0))

    lead = "Сценарий готов" if not first_name else f"{first_name}, сценарий готов"
    lines = [
        f"*{_escape_markdown_v2(lead)}*",
        f"Survival {_escape_markdown_v2(f'{survival_probability:.1f}%')}",
        f"Horizon {_escape_markdown_v2(f'{months}m')}",
        f"Delay {_escape_markdown_v2(f'{delay_months}m')}",
        f"P10 {_escape_markdown_v2(_format_currency(p10))}",
        f"P50 {_escape_markdown_v2(_format_currency(p50))}",
        f"P90 {_escape_markdown_v2(_format_currency(p90))}",
    ]
    return "\n".join(lines)


def _build_error_text(message: str) -> str:
    return f"*Не удалось обработать сценарий*\n{_escape_markdown_v2(message)}"


def _extract_parser_text(parsed: Mapping[str, Any], field: str) -> str:
    value = parsed.get(field)
    if not isinstance(value, str):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": field},
            False,
        )

    text = value.strip()
    if not text and field != "question":
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": field},
            False,
        )

    return text


def _build_comment_text(comment: str, trailing_block: str | None = None) -> str:
    parts = [_escape_markdown_v2(comment)]
    if trailing_block:
        parts.append(trailing_block)

    return "\n\n".join(parts)


def _build_clarification_text(comment: str, question: str | None) -> str:
    message = _build_comment_text(comment)
    if question:
        message = f"{message}\n\n{_escape_markdown_v2(question)}"
    return message


def _build_ready_caption_with_comment(
    first_name: str | None,
    params: Mapping[str, Any],
    simulation_data: Mapping[str, Any],
    comment: str,
) -> str:
    return _build_comment_text(comment, _build_ready_caption(first_name, params, simulation_data))


def _send_telegram_message(chat_id: int, text: str) -> dict[str, Any]:
    token = _require_bot_token()
    response = requests.post(
        f"{TELEGRAM_API_BASE_URL}/bot{token}/sendMessage",
        json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "MarkdownV2",
        },
        timeout=TELEGRAM_TIMEOUT_SECONDS,
    )

    if response.status_code >= 400:
        raise ApiProblem(
            "INTERNAL_ERROR",
            f"Telegram API sendMessage failed with HTTP {response.status_code}",
            {"response_text": response.text},
            True,
        )

    try:
        response_body = response.json()
    except json.JSONDecodeError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Telegram API sendMessage returned invalid JSON",
            None,
            True,
        ) from exc

    if not isinstance(response_body, Mapping) or response_body.get("ok") is not True:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Telegram API sendMessage was rejected",
            {"response": response_body},
            True,
        )

    return dict(response_body)


def _send_telegram_photo(chat_id: int, png_buffer: BytesIO, caption: str) -> dict[str, Any]:
    token = _require_bot_token()
    response = requests.post(
        f"{TELEGRAM_API_BASE_URL}/bot{token}/sendPhoto",
        data={
            "chat_id": str(chat_id),
            "caption": caption,
            "parse_mode": "MarkdownV2",
        },
        files={
            "photo": ("monterun-runway.png", png_buffer, "image/png"),
        },
        timeout=TELEGRAM_TIMEOUT_SECONDS,
    )

    if response.status_code >= 400:
        raise ApiProblem(
            "INTERNAL_ERROR",
            f"Telegram API sendPhoto failed with HTTP {response.status_code}",
            {"response_text": response.text},
            True,
        )

    try:
        response_body = response.json()
    except json.JSONDecodeError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Telegram API sendPhoto returned invalid JSON",
            None,
            True,
        ) from exc

    if not isinstance(response_body, Mapping) or response_body.get("ok") is not True:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Telegram API sendPhoto was rejected",
            {"response": response_body},
            True,
        )

    return dict(response_body)


class handler(BaseHTTPRequestHandler):
    server_version = "MonteRun"
    sys_version = ""

    def do_POST(self) -> None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        started_at = time.perf_counter()

        try:
            body = self._read_json_body()
            update = self._extract_update(body)
            message = _extract_message(update)
            user_text = _extract_message_text(message)
            chat_id = _extract_chat_id(message)
            telegram_user_id = _extract_telegram_user_id(message)
            first_name = _extract_first_name(message)

            parsed, simulation_data = _process_parse_flow(user_text, telegram_user_id, request_id)
            print(json.dumps(parsed, ensure_ascii=False, sort_keys=True), flush=True)
            comment = _extract_parser_text(parsed, "comment")
            if parsed["status"] == "ready" and simulation_data is not None:
                png_buffer = _render_simulation_png(simulation_data)
                try:
                    telegram_response = _send_telegram_photo(
                        chat_id,
                        png_buffer,
                        _build_ready_caption_with_comment(first_name, parsed["params"], simulation_data, comment),
                    )
                finally:
                    png_buffer.close()

                data = {
                    "status": "ready",
                    "chat_id": chat_id,
                    "telegram_user_id": telegram_user_id,
                    "telegram_method": "sendPhoto",
                    "parse": parsed,
                    "simulation": simulation_data,
                    "telegram_response": telegram_response,
                }
            else:
                question = _extract_parser_text(parsed, "question") if parsed.get("question") is not None else None
                telegram_response = _send_telegram_message(chat_id, _build_clarification_text(comment, question))
                data = {
                    "status": "needs_clarification",
                    "chat_id": chat_id,
                    "telegram_user_id": telegram_user_id,
                    "telegram_method": "sendMessage",
                    "parse": parsed,
                    "telegram_response": telegram_response,
                }
            error = None
        except ApiProblem as exc:
            data = None
            error = _build_error(exc.code, exc.message, exc.details, exc.retryable)
            chat_id = locals().get("chat_id")
            if isinstance(chat_id, int):
                try:
                    _send_telegram_message(chat_id, _build_error_text(exc.message))
                except Exception:
                    LOGGER.exception("Failed to send Telegram error message", extra={"request_id": request_id})
        except Exception:
            LOGGER.exception("Unhandled tg_webhook error", extra={"request_id": request_id})
            data = None
            error = _build_error(
                "INTERNAL_ERROR",
                "Internal server error",
                None,
                False,
            )
            chat_id = locals().get("chat_id")
            if isinstance(chat_id, int):
                try:
                    _send_telegram_message(chat_id, _build_error_text("Internal server error"))
                except Exception:
                    LOGGER.exception("Failed to send Telegram fatal error message", extra={"request_id": request_id})

        meta = _build_meta(request_id, started_at)
        self._send_envelope({"data": data, "error": error, "meta": meta}, meta["simulation_time_ms"], request_id)

    def do_GET(self) -> None:
        self._send_method_not_allowed()

    def do_PUT(self) -> None:
        self._send_method_not_allowed()

    def do_PATCH(self) -> None:
        self._send_method_not_allowed()

    def do_DELETE(self) -> None:
        self._send_method_not_allowed()

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _read_json_body(self) -> dict[str, Any]:
        content_length_header = self.headers.get("Content-Length")
        if content_length_header is None:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Content-Length header is required",
                {"header": "Content-Length"},
                False,
            )

        try:
            content_length = int(content_length_header)
        except ValueError as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Invalid Content-Length header",
                {"header": "Content-Length", "value": content_length_header},
                False,
            ) from exc

        if content_length <= 0:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body is required",
                {"min_bytes": 1},
                False,
            )

        if content_length >= MAX_PAYLOAD_BYTES:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Payload too large",
                {"max_bytes": MAX_PAYLOAD_BYTES - 1},
                False,
            )

        raw_body = self.rfile.read(content_length)
        if len(raw_body) != content_length:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Incomplete request body",
                {"expected_bytes": content_length, "received_bytes": len(raw_body)},
                False,
            )

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except UnicodeDecodeError as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body must be valid UTF-8 JSON",
                None,
                False,
            ) from exc
        except json.JSONDecodeError as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body must be valid JSON",
                {"line": exc.lineno, "column": exc.colno},
                False,
            ) from exc

        if not isinstance(payload, dict):
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body must be a JSON object",
                {"type": type(payload).__name__},
                False,
            )

        return payload

    def _extract_update(self, body: Mapping[str, Any]) -> Mapping[str, Any]:
        update = body.get("update")
        if isinstance(update, Mapping):
            return update
        return body

    def _send_method_not_allowed(self) -> None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        started_at = time.perf_counter()
        meta = _build_meta(request_id, started_at)
        payload = json.dumps(
            {
                "data": None,
                "error": _build_error(
                    "INVALID_PARAMS",
                    "Method not allowed. Use POST.",
                    {"allowed_methods": ["POST"], "method": self.command},
                    False,
                ),
                "meta": meta,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        self.send_response(200)
        self.send_header("Allow", "POST")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Request-ID", request_id)
        self.send_header("X-Server-Timing", f"total;dur={meta['simulation_time_ms']}")
        self.end_headers()
        self.wfile.write(payload)

    def _send_envelope(self, payload: dict[str, Any], elapsed_ms: int, request_id: str) -> None:
        response_bytes = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        self.send_response(200)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("X-Request-ID", request_id)
        self.send_header("X-Server-Timing", f"total;dur={elapsed_ms}")
        self.end_headers()
        self.wfile.write(response_bytes)
