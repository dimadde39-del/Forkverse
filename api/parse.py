from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Final

import httpx


SCHEMA_VERSION: Final[str] = "2026-04"
MAX_PAYLOAD_BYTES: Final[int] = 1_000_000
MODEL_NAME: Final[str] = "gemini-2.5-flash"
REQUEST_TIMEOUT_SECONDS: Final[float] = 20.0
PROJECT_ROOT: Final[Path] = Path(__file__).parent.parent.resolve()
PROMPT_PATH: Final[Path] = PROJECT_ROOT / "prompts" / "parser_v1.txt"
ENV_PATH: Final[Path] = PROJECT_ROOT / ".env"
GOOGLE_API_URL: Final[str] = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:generateContent"
PARSER_RESPONSE_SCHEMA: Final[dict[str, Any]] = {
    "type": "OBJECT",
    "properties": {
        "status": {"type": "STRING"},
        "params": {
            "type": "OBJECT",
            "properties": {
                "initial_capital": {"type": "INTEGER"},
                "monthly_burn": {"type": "INTEGER"},
                "monthly_income": {"type": "INTEGER"},
                "months": {"type": "INTEGER"},
                "n_simulations": {"type": "INTEGER"},
            },
            "required": ["initial_capital", "monthly_burn", "monthly_income", "months", "n_simulations"],
        },
        "question": {"type": "STRING"},
    },
    "required": ["status"],
}

LOGGER = logging.getLogger(__name__)


class ApiProblem(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details
        self.retryable = retryable


def _load_local_env_file() -> None:
    if not ENV_PATH.exists():
        return

    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        os.environ[key] = value.strip()


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


@lru_cache(maxsize=1)
def _load_system_prompt() -> str:
    try:
        prompt_text = PROMPT_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Parser prompt is not configured",
            {"path": str(PROMPT_PATH)},
            False,
        ) from exc
    except OSError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Failed to read parser prompt",
            {"path": str(PROMPT_PATH), "reason": str(exc)},
            False,
        ) from exc

    if not prompt_text:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Parser prompt is empty",
            {"path": str(PROMPT_PATH)},
            False,
        )

    return prompt_text


def _require_api_key() -> str:
    api_key = os.environ.get("PROVIDER_API_KEY", "").strip()
    if not api_key:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Provider API key is not configured",
            {"env": "PROVIDER_API_KEY"},
            False,
        )

    return api_key


def _coerce_int(name: str, value: Any, minimum: int | None = None, maximum: int | None = None) -> int:
    if isinstance(value, bool):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": name, "reason": "boolean_not_allowed"},
            False,
        )

    if isinstance(value, int):
        coerced = value
    elif isinstance(value, float):
        if not value.is_integer():
            raise ApiProblem(
                "INTERNAL_ERROR",
                "LLM returned invalid JSON payload",
                {"field": name, "reason": "non_integral_number"},
                False,
            )
        coerced = int(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            raise ApiProblem(
                "INTERNAL_ERROR",
                "LLM returned invalid JSON payload",
                {"field": name, "reason": "empty_string"},
                False,
            )
        try:
            numeric_value = float(stripped)
        except ValueError as exc:
            raise ApiProblem(
                "INTERNAL_ERROR",
                "LLM returned invalid JSON payload",
                {"field": name, "reason": "non_numeric_string"},
                False,
            ) from exc
        if not numeric_value.is_integer():
            raise ApiProblem(
                "INTERNAL_ERROR",
                "LLM returned invalid JSON payload",
                {"field": name, "reason": "non_integral_string"},
                False,
            )
        coerced = int(numeric_value)
    else:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": name, "reason": "unsupported_type"},
            False,
        )

    if minimum is not None and coerced < minimum:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": name, "reason": "below_minimum", "minimum": minimum},
            False,
        )

    if maximum is not None and coerced > maximum:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": name, "reason": "above_maximum", "maximum": maximum},
            False,
        )

    return coerced


def _normalize_llm_payload(payload: dict[str, Any]) -> dict[str, Any]:
    status = payload.get("status")
    if status not in {"ready", "needs_clarification"}:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": "status"},
            False,
        )

    if status == "needs_clarification":
        question = payload.get("question")
        if not isinstance(question, str) or not question.strip():
            raise ApiProblem(
                "INTERNAL_ERROR",
                "LLM returned invalid JSON payload",
                {"field": "question"},
                False,
            )

        return {
            "status": "needs_clarification",
            "params": None,
            "question": question.strip(),
        }

    raw_params = payload.get("params")
    if not isinstance(raw_params, Mapping):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON payload",
            {"field": "params"},
            False,
        )

    params = {
        "initial_capital": _coerce_int("initial_capital", raw_params.get("initial_capital"), minimum=0),
        "monthly_burn": _coerce_int("monthly_burn", raw_params.get("monthly_burn"), minimum=0),
        "monthly_income": _coerce_int("monthly_income", raw_params.get("monthly_income"), minimum=0),
        "months": _coerce_int("months", raw_params.get("months", 6), minimum=1),
        "n_simulations": _coerce_int("n_simulations", raw_params.get("n_simulations", 4000), minimum=1, maximum=4000),
    }

    return {
        "status": "ready",
        "params": params,
        "question": None,
    }


def _extract_candidate_text(response_body: dict[str, Any]) -> str:
    candidates = response_body.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    first_candidate = candidates[0]
    if not isinstance(first_candidate, Mapping):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    content = first_candidate.get("content")
    if not isinstance(content, Mapping):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    parts = content.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    text_fragments = [
        part.get("text", "")
        for part in parts
        if isinstance(part, Mapping) and isinstance(part.get("text"), str)
    ]
    candidate_text = "".join(text_fragments).strip()
    if not candidate_text:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    return candidate_text


def _call_gemini(user_text: str) -> dict[str, Any]:
    try:
        system_prompt = _load_system_prompt()
    except ApiProblem:
        raise
    except Exception as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Failed to load parser prompt",
            {"path": str(PROMPT_PATH), "reason": str(exc)},
            False,
        ) from exc

    api_key = _require_api_key()

    payload = {
        "systemInstruction": {
            "parts": [
                {
                    "text": system_prompt,
                }
            ]
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": user_text,
                    }
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": PARSER_RESPONSE_SCHEMA,
        },
    }

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = client.post(GOOGLE_API_URL, headers=headers, json=payload)

            if response.status_code >= 400:
                error_details = response.text
                raise ApiProblem(
                    "INTERNAL_ERROR",
                    f"LLM API Error {response.status_code}: {error_details}",
                    None,
                    False,
                )
            response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise ApiProblem("INTERNAL_ERROR", "LLM request timed out", None, True) from exc
    except httpx.RequestError as exc:
        raise ApiProblem("INTERNAL_ERROR", f"Network error: {str(exc)}", None, True) from exc

    try:
        response_body = response.json()
    except json.JSONDecodeError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM provider returned invalid JSON",
            None,
            False,
        ) from exc

    candidate_text = _extract_candidate_text(response_body)
    try:
        llm_payload = json.loads(candidate_text)
    except json.JSONDecodeError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON",
            {"reason": "invalid_json"},
            False,
        ) from exc

    if not isinstance(llm_payload, dict):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM returned invalid JSON",
            {"reason": "non_object"},
            False,
        )

    return _normalize_llm_payload(llm_payload)


_load_local_env_file()


class handler(BaseHTTPRequestHandler):
    server_version = "ForkVerse"
    sys_version = ""

    def do_POST(self) -> None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        started_at = time.perf_counter()

        try:
            body = self._read_json_body()
            user_text = self._extract_text(body)
            data = _call_gemini(user_text)
            error = None
        except ApiProblem as exc:
            data = None
            error = _build_error(exc.code, exc.message, exc.details, exc.retryable)
        except Exception:
            LOGGER.exception("Unhandled parse error", extra={"request_id": request_id})
            data = None
            error = _build_error(
                "INTERNAL_ERROR",
                "Internal server error",
                None,
                False,
            )

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

        if len(raw_body) >= MAX_PAYLOAD_BYTES:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Payload too large",
                {"max_bytes": MAX_PAYLOAD_BYTES - 1},
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

    def _extract_text(self, body: dict[str, Any]) -> str:
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ApiProblem(
                "INVALID_PARAMS",
                "text is required",
                {"field": "text"},
                False,
            )

        return text.strip()

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
