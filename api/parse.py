from __future__ import annotations

import json
import logging
import os
import sys
import time
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from importlib.machinery import PathFinder
from importlib.util import module_from_spec
from pathlib import Path
from typing import Any, Final

import httpx
import numpy as np


SCHEMA_VERSION: Final[str] = "2026-04"
MAX_PAYLOAD_BYTES: Final[int] = 1_000_000
MODEL_NAME: Final[str] = "llama-3.3-70b-versatile"
REQUEST_TIMEOUT_SECONDS: Final[float] = 20.0
PROJECT_ROOT: Final[Path] = Path(__file__).parent.parent.resolve()
PROMPT_PATH: Final[Path] = PROJECT_ROOT / "prompts" / "parser_v1.txt"
ENV_PATH: Final[Path] = PROJECT_ROOT / ".env"
GROQ_API_URL: Final[str] = "https://api.groq.com/openai/v1/chat/completions"
SUPABASE_URL_ENV: Final[str] = "SUPABASE_URL"
SUPABASE_SERVICE_ROLE_KEY_ENV: Final[str] = "SUPABASE_SERVICE_ROLE_KEY"
TELEGRAM_CONTEXT_TABLE: Final[str] = "telegram_context"
SCENARIO_STATE_TABLE: Final[str] = "scenario_state"
PARSER_RESPONSE_SCHEMA: Final[dict[str, Any]] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "status": {
            "type": "string",
            "enum": ["ready", "needs_clarification"],
        },
        "params": {
            "type": ["object", "null"],
            "additionalProperties": False,
            "properties": {
                "initial_capital": {"type": "integer"},
                "monthly_burn": {"type": "integer"},
                "monthly_income": {"type": "integer"},
                "income_delay_months": {"type": "integer", "default": 0},
                "months": {"type": "integer"},
                "n_simulations": {"type": "integer"},
            },
            "required": [
                "initial_capital",
                "monthly_burn",
                "monthly_income",
                "months",
                "n_simulations",
            ],
        },
        "question": {"type": ["string", "null"]},
    },
    "required": ["status", "params", "question"],
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


@lru_cache(maxsize=1)
def _load_supabase_sdk():
    site_packages_paths = [path for path in sys.path if "site-packages" in path.lower()]
    spec = PathFinder.find_spec("supabase", site_packages_paths or None)
    if spec is None or spec.loader is None:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "supabase-py is not installed",
            {"package": "supabase"},
            False,
        )

    module = module_from_spec(spec)
    previous_module = sys.modules.get("supabase")
    sys.modules["supabase"] = module

    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        if previous_module is not None:
            sys.modules["supabase"] = previous_module
        else:
            sys.modules.pop("supabase", None)
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Failed to load supabase-py",
            {"package": "supabase", "reason": str(exc)},
            False,
        ) from exc

    return module


@lru_cache(maxsize=1)
def _get_supabase_client():
    supabase_url = os.environ.get(SUPABASE_URL_ENV, "").strip()
    supabase_service_role_key = os.environ.get(SUPABASE_SERVICE_ROLE_KEY_ENV, "").strip()

    if not supabase_url or not supabase_service_role_key:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Supabase is not configured",
            {
                "env": [SUPABASE_URL_ENV, SUPABASE_SERVICE_ROLE_KEY_ENV],
            },
            False,
        )

    supabase_sdk = _load_supabase_sdk()

    try:
        return supabase_sdk.create_client(supabase_url, supabase_service_role_key)
    except Exception as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Failed to initialize Supabase client",
            {"reason": str(exc)},
            False,
        ) from exc


def _is_table_missing_error(exc: Exception) -> bool:
    if "PGRST205" in str(exc):
        return True

    response = getattr(exc, "message", None)
    return isinstance(response, Mapping) and response.get("code") == "PGRST205"


def _extract_json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None

        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError:
            return None

        if isinstance(decoded, Mapping):
            return dict(decoded)

    return None


def _extract_first_text(row: Mapping[str, Any], fields: tuple[str, ...]) -> str | None:
    for field in fields:
        value = row.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def _fetch_optional_supabase_row(table: str, *, telegram_user_id: int) -> dict[str, Any] | None:
    try:
        response = _get_supabase_client().table(table).select("*").eq("telegram_user_id", telegram_user_id).limit(1).execute()
    except ApiProblem:
        raise
    except Exception as exc:
        if _is_table_missing_error(exc):
            LOGGER.warning("Supabase table %s is missing; skipping Telegram state integration", table)
            return None

        LOGGER.warning("Supabase lookup failed for %s: %s", table, exc)
        return None

    rows = response.data or []
    if not rows:
        return None

    first_row = rows[0]
    return dict(first_row) if isinstance(first_row, Mapping) else None


def _build_parser_context_payload(
    telegram_context_row: Mapping[str, Any] | None,
    scenario_state_row: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    payload: dict[str, Any] = {}

    if telegram_context_row is not None:
        context_text = _extract_first_text(
            telegram_context_row,
            ("context_text", "context_summary", "summary", "context", "notes", "parser_context"),
        )
        base_params = _extract_json_object(telegram_context_row.get("base_params"))

        if context_text:
            payload["telegram_context"] = context_text
        if base_params:
            payload["base_params"] = base_params

    if scenario_state_row is not None:
        previous_params = _extract_json_object(scenario_state_row.get("params"))
        previous_source_text = _extract_first_text(scenario_state_row, ("source_text", "message_text", "user_text"))

        if previous_params:
            payload["previous_scenario"] = previous_params
        if previous_source_text:
            payload["previous_user_message"] = previous_source_text

    return payload or None


def _build_parser_input(user_text: str, parser_context_payload: Mapping[str, Any] | None) -> str:
    if not parser_context_payload:
        return user_text

    context_json = json.dumps(parser_context_payload, ensure_ascii=False, separators=(",", ":"))
    return (
        "BASE_CONTEXT_JSON:"
        f"{context_json}\n"
        "Используй BASE_CONTEXT_JSON как доверенную базу для всех полей, которых нет в новом сообщении. "
        "Если новое сообщение явно меняет поле, новое сообщение важнее.\n"
        f"USER_MESSAGE:{user_text}"
    )


def _resolve_profile_id(
    telegram_user_id: int,
    telegram_context_row: Mapping[str, Any] | None,
    scenario_state_row: Mapping[str, Any] | None,
) -> str | None:
    for row in (scenario_state_row, telegram_context_row):
        if row is None:
            continue

        profile_id = row.get("profile_id")
        if isinstance(profile_id, str) and profile_id.strip():
            return profile_id.strip()

    try:
        response = (
            _get_supabase_client()
            .table("profiles")
            .select("id")
            .eq("telegram_user_id", telegram_user_id)
            .limit(1)
            .execute()
        )
    except ApiProblem:
        raise
    except Exception as exc:
        if _is_table_missing_error(exc):
            LOGGER.warning("Supabase table profiles is missing; scenario_state will be stored without profile_id")
            return None

        LOGGER.warning("Failed to resolve profile_id for Telegram user %s: %s", telegram_user_id, exc)
        return None

    rows = response.data or []
    if not rows or not isinstance(rows[0], Mapping):
        return None

    profile_id = rows[0].get("id")
    return profile_id.strip() if isinstance(profile_id, str) and profile_id.strip() else None


def _load_telegram_parser_context(
    telegram_user_id: int | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    if telegram_user_id is None:
        return None, None, None

    try:
        telegram_context_row = _fetch_optional_supabase_row(TELEGRAM_CONTEXT_TABLE, telegram_user_id=telegram_user_id)
        scenario_state_row = _fetch_optional_supabase_row(SCENARIO_STATE_TABLE, telegram_user_id=telegram_user_id)
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed; continuing without Telegram context: %s", exc.message)
        return None, None, None

    parser_context_payload = _build_parser_context_payload(telegram_context_row, scenario_state_row)
    return parser_context_payload, telegram_context_row, scenario_state_row


def _persist_scenario_state(
    *,
    telegram_user_id: int | None,
    request_id: str,
    source_text: str,
    params: Mapping[str, Any],
    simulation_data: Mapping[str, Any],
    telegram_context_row: Mapping[str, Any] | None,
    scenario_state_row: Mapping[str, Any] | None,
) -> None:
    if telegram_user_id is None:
        return

    simulation_summary = {
        "status": "ready",
        "survival_probability": simulation_data.get("survival_probability"),
        "n_simulations": simulation_data.get("n_simulations"),
        "months": simulation_data.get("months"),
        "p10": simulation_data.get("p10"),
        "p50": simulation_data.get("p50"),
        "p90": simulation_data.get("p90"),
    }

    try:
        profile_id = _resolve_profile_id(telegram_user_id, telegram_context_row, scenario_state_row)
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed during scenario_state save: %s", exc.message)
        profile_id = None

    payload: dict[str, Any] = {
        "telegram_user_id": telegram_user_id,
        "latest_request_id": request_id,
        "source_text": source_text,
        "params": dict(params),
        "simulation_summary": simulation_summary,
    }

    if profile_id is not None:
        payload["profile_id"] = profile_id

    try:
        _get_supabase_client().table(SCENARIO_STATE_TABLE).upsert(payload, on_conflict="telegram_user_id").execute()
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed during scenario_state upsert: %s", exc.message)
    except Exception as exc:
        if _is_table_missing_error(exc):
            LOGGER.warning("Supabase table %s is missing; scenario_state was not persisted", SCENARIO_STATE_TABLE)
            return

        LOGGER.warning("Failed to upsert scenario_state for Telegram user %s: %s", telegram_user_id, exc)


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
        "income_delay_months": _coerce_int("income_delay_months", raw_params.get("income_delay_months", 0), minimum=0),
        "months": _coerce_int("months", raw_params.get("months", 6), minimum=1),
        "n_simulations": _coerce_int("n_simulations", raw_params.get("n_simulations", 100), minimum=1, maximum=4000),
    }

    return {
        "status": "ready",
        "params": params,
        "question": None,
    }


def _run_simulation(
    initial_capital: int,
    monthly_income: int,
    monthly_burn: int,
    months: int = 36,
    n_simulations: int = 100,
    income_delay_months: int = 0,
) -> list[list[float]]:
    initial_capital_value = _coerce_int("initial_capital", initial_capital, minimum=0)
    monthly_income_value = _coerce_int("monthly_income", monthly_income, minimum=0)
    monthly_burn_value = _coerce_int("monthly_burn", monthly_burn, minimum=0)
    months_value = _coerce_int("months", months, minimum=1)
    n_simulations_value = _coerce_int("n_simulations", n_simulations, minimum=1, maximum=4000)
    income_delay_months_value = _coerce_int("income_delay_months", income_delay_months, minimum=0)

    if initial_capital_value == 0:
        return np.zeros((n_simulations_value, months_value + 1), dtype=np.float64).tolist()

    rng = np.random.default_rng()
    income_noise = rng.normal(1.0, 0.15, size=(n_simulations_value, months_value))
    burn_noise = rng.normal(1.0, 0.15, size=(n_simulations_value, months_value))

    realized_income = np.maximum(0.0, float(monthly_income_value) * income_noise)
    realized_burn = np.maximum(0.0, float(monthly_burn_value) * burn_noise)

    if income_delay_months_value > 0:
        delayed_months = min(income_delay_months_value, months_value)
        realized_income[:, :delayed_months] = 0.0

    monthly_changes = realized_income - realized_burn

    capital_paths = float(initial_capital_value) + np.cumsum(monthly_changes, axis=1, dtype=np.float64)
    bankrupt_mask = np.maximum.accumulate(capital_paths <= 0.0, axis=1)
    capital_paths = np.where(bankrupt_mask, 0.0, capital_paths)

    initial_column = np.full((n_simulations_value, 1), float(initial_capital_value), dtype=np.float64)
    trajectories = np.concatenate((initial_column, capital_paths), axis=1)

    return np.round(trajectories, 2).tolist()


def _build_simulation_response(trajectories: list[list[float]]) -> dict[str, Any]:
    array = np.asarray(trajectories, dtype=np.float64)
    if array.ndim != 2 or array.shape[0] < 1 or array.shape[1] < 2:
        raise RuntimeError("Simulation output must be a non-empty 2D array with horizon data")

    percentiles = np.percentile(array, q=np.array([10.0, 50.0, 90.0]), axis=0, method="linear")
    survival_probability = float(np.mean(np.all(array[:, 1:] > 0.0, axis=1), dtype=np.float64))
    sample_size = min(int(array.shape[0]), 50)
    sample_indices = np.linspace(0, array.shape[0] - 1, num=sample_size, dtype=np.int64)

    return {
        "months": np.arange(array.shape[1], dtype=np.int64).tolist(),
        "n_simulations": int(array.shape[0]),
        "survival_probability": survival_probability,
        "p10": np.round(percentiles[0], 2).tolist(),
        "p50": np.round(percentiles[1], 2).tolist(),
        "p90": np.round(percentiles[2], 2).tolist(),
        "spaghetti_sample": np.round(array[sample_indices], 2).tolist(),
    }


def _extract_response_text(response_body: dict[str, Any]) -> str:
    choices = response_body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    first_choice = choices[0]
    if not isinstance(first_choice, Mapping):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    message = first_choice.get("message")
    if not isinstance(message, Mapping):
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ApiProblem(
            "INTERNAL_ERROR",
            "LLM response was empty",
            None,
            False,
        )

    return content.strip()


def _call_groq(user_text: str) -> dict[str, Any]:
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
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_text,
            }
        ],
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = client.post(GROQ_API_URL, headers=headers, json=payload)

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

    candidate_text = _extract_response_text(response_body)
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
            telegram_user_id = self._extract_optional_telegram_user_id(body)
            parser_context_payload, telegram_context_row, scenario_state_row = _load_telegram_parser_context(telegram_user_id)
            parser_input = _build_parser_input(user_text, parser_context_payload)
            data = _call_groq(parser_input)
            if data.get("status") == "ready":
                params = data.get("params")
                if not isinstance(params, dict):
                    raise ApiProblem(
                        "INTERNAL_ERROR",
                        "LLM returned invalid JSON payload",
                        {"field": "params"},
                        False,
                    )

                trajectories = _run_simulation(
                    params["initial_capital"],
                    params["monthly_income"],
                    params["monthly_burn"],
                    months=params["months"],
                    n_simulations=params["n_simulations"],
                    income_delay_months=params.get("income_delay_months", 0),
                )
                simulation_data = _build_simulation_response(trajectories)
                data = {
                    "status": "ready",
                    "params": params,
                    **simulation_data,
                }
                _persist_scenario_state(
                    telegram_user_id=telegram_user_id,
                    request_id=request_id,
                    source_text=user_text,
                    params=params,
                    simulation_data=simulation_data,
                    telegram_context_row=telegram_context_row,
                    scenario_state_row=scenario_state_row,
                )
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

    def _extract_optional_telegram_user_id(self, body: dict[str, Any]) -> int | None:
        if "telegram_user_id" not in body or body["telegram_user_id"] is None:
            return None

        try:
            return _coerce_int("telegram_user_id", body.get("telegram_user_id"), minimum=1)
        except ApiProblem as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "telegram_user_id must be a positive integer",
                exc.details,
                False,
            ) from exc

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
