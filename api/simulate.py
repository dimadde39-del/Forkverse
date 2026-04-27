from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from typing import Any, Final

import numpy as np


SCHEMA_VERSION: Final[str] = "2026-04"
MAX_PAYLOAD_BYTES: Final[int] = 1_000_000
INCOME_DELAY_MONTHS_FIELD: Final[str] = "income_delay_months"
CAPITAL_SHOCK_FIELD: Final[str] = "capital_shock"
BURN_MULTIPLIER_FIELD: Final[str] = "burn_multiplier"

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


def get_engine():
    from engine.monte_carlo import compute_metrics, simulate

    return simulate, compute_metrics


def _first_month_median_depletes(paths: Any) -> float:
    array = np.asarray(paths, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] < 2:
        raise RuntimeError("paths must contain at least one month plus the initial state")

    monthly_capital = array[:, 1:]
    median_capital = np.median(monthly_capital, axis=0)
    depleted_months = np.flatnonzero(median_capital <= 0.0)

    if depleted_months.size == 0:
        return float(monthly_capital.shape[1])

    return float(depleted_months[0] + 1)


def _survival_probability_at_month(paths: Any, month_number: int) -> float:
    array = np.asarray(paths, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] < 2:
        raise RuntimeError("paths must contain at least one month plus the initial state")

    month_index = min(max(month_number, 1), array.shape[1] - 1)
    return float(np.mean(array[:, month_index] > 0.0, dtype=np.float64) * 100.0)


def _build_math_summary(paths: Any, params: dict[str, Any], simulate: Any) -> dict[str, Any]:
    base_runway_months = _first_month_median_depletes(paths)
    monthly_income = float(params["monthly_income"])
    monthly_burn = float(params["monthly_burn"])

    lever_specs: tuple[tuple[str, dict[str, float]], ...] = (
        ("Cut monthly burn by 50%", {"monthly_burn": monthly_burn * 0.5}),
        ("Increase monthly income by 20%", {"monthly_income": monthly_income * 1.2}),
        ("Reduce monthly burn by 10%", {"monthly_burn": monthly_burn * 0.9}),
    )
    levers: list[dict[str, float | str]] = []

    for action, patch in lever_specs:
        lever_params = {**params, **patch}
        lever_paths = simulate(**lever_params)
        levers.append(
            {
                "action": action,
                "impact_months": max(0.0, _first_month_median_depletes(lever_paths) - base_runway_months),
            }
        )

    levers.sort(key=lambda item: (-float(item["impact_months"]), str(item["action"])))

    return {
        "base_runway_months": base_runway_months,
        "survival_probability_12m": _survival_probability_at_month(paths, 12),
        "levers": levers,
    }


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


def _coerce_non_negative_int(name: str, value: Any, *, default: int = 0) -> int:
    if value is None:
        return default

    if isinstance(value, bool):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a non-negative integer",
            {"field": name, "reason": "boolean_not_allowed"},
            False,
        )

    try:
        coerced = int(value)
    except (TypeError, ValueError) as exc:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a non-negative integer",
            {"field": name, "reason": "non_integer_value"},
            False,
        ) from exc

    if coerced != value and not (isinstance(value, str) and value.strip() == str(coerced)):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a non-negative integer",
            {"field": name, "reason": "non_integer_value"},
            False,
        )

    if coerced < 0:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a non-negative integer",
            {"field": name, "reason": "below_minimum", "minimum": 0},
            False,
        )

    return coerced


def _coerce_non_negative_float(name: str, value: Any, *, default: float = 0.0) -> float:
    if value is None:
        return default

    if isinstance(value, bool):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a non-negative number",
            {"field": name, "reason": "boolean_not_allowed"},
            False,
        )

    try:
        coerced = float(value)
    except (TypeError, ValueError) as exc:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a non-negative number",
            {"field": name, "reason": "non_numeric_value"},
            False,
        ) from exc

    if not np.isfinite(coerced):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a finite number",
            {"field": name, "reason": "non_finite_value"},
            False,
        )

    if coerced < 0.0:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a non-negative number",
            {"field": name, "reason": "below_minimum", "minimum": 0},
            False,
        )

    return coerced


class handler(BaseHTTPRequestHandler):
    server_version = "MonteRun"
    sys_version = ""

    def do_POST(self) -> None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        started_at = time.perf_counter()

        try:
            body = self._read_json_body()
            params = self._extract_params(body)
            data = self._run_simulation(params)
            error = None
        except ApiProblem as exc:
            data = None
            error = _build_error(exc.code, exc.message, exc.details, exc.retryable)
        except TimeoutError:
            data = None
            error = _build_error(
                "SIMULATION_TIMEOUT",
                "Simulation timeout",
                None,
                True,
            )
        except NotImplementedError:
            data = None
            error = _build_error(
                "INTERNAL_ERROR",
                "Simulation engine unavailable",
                None,
                False,
            )
        except Exception:
            LOGGER.exception("Unhandled simulate error", extra={"request_id": request_id})
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

    def _extract_params(self, body: dict[str, Any]) -> dict[str, Any]:
        if "params" not in body:
            raise ApiProblem(
                "INVALID_PARAMS",
                "params is required",
                {"field": "params"},
                False,
            )

        params = body["params"]
        if not isinstance(params, Mapping):
            raise ApiProblem(
                "INVALID_PARAMS",
                "params must be a JSON object",
                {"field": "params", "type": type(params).__name__},
                False,
            )

        normalized_params = dict(params)
        if not all(isinstance(key, str) for key in normalized_params):
            raise ApiProblem(
                "INVALID_PARAMS",
                "params keys must be strings",
                {"field": "params"},
                False,
            )

        normalized_params[INCOME_DELAY_MONTHS_FIELD] = _coerce_non_negative_int(
            INCOME_DELAY_MONTHS_FIELD,
            normalized_params.get(INCOME_DELAY_MONTHS_FIELD),
            default=0,
        )
        normalized_params[CAPITAL_SHOCK_FIELD] = _coerce_non_negative_float(
            CAPITAL_SHOCK_FIELD,
            normalized_params.get(CAPITAL_SHOCK_FIELD),
            default=0.0,
        )
        normalized_params[BURN_MULTIPLIER_FIELD] = _coerce_non_negative_float(
            BURN_MULTIPLIER_FIELD,
            normalized_params.get(BURN_MULTIPLIER_FIELD),
            default=1.0,
        )

        return normalized_params

    def _run_simulation(self, params: dict[str, Any]) -> dict[str, Any]:
        simulate, compute_metrics = get_engine()
        if not callable(simulate) or not callable(compute_metrics):
            raise RuntimeError("get_engine() must return callable simulate and compute_metrics functions")

        try:
            paths = simulate(**params)
        except TypeError as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Invalid simulation parameters",
                {"reason": "signature_mismatch"},
                False,
            ) from exc

        result = compute_metrics(paths)
        if not isinstance(result, dict):
            raise RuntimeError("compute_metrics() must return a JSON-serializable object")

        result.update(_build_math_summary(paths, params, simulate))

        try:
            json.dumps(result)
        except (TypeError, ValueError) as exc:
            raise RuntimeError("compute_metrics() must return a JSON-serializable object") from exc

        return result

    def _send_method_not_allowed(self) -> None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        started_at = time.perf_counter()
        meta = _build_meta(request_id, started_at)
        self.send_response(200)
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

