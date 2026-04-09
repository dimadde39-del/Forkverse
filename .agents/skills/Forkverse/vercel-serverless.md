name: vercel-serverless
description: Как правильно деплоить Python Monte-Carlo на Vercel в 2026.

## Production handler (канонический v5)
```python
# api/simulate.py
from http.server import BaseHTTPRequestHandler
import json, time, uuid
from datetime import datetime

def get_engine():  # настоящий lazy import
    from engine.monte_carlo import simulate, compute_metrics
    return simulate, compute_metrics

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        request_id = str(uuid.uuid4())[:8]
        start = time.perf_counter()

        try:
            length = int(self.headers.get('Content-Length', 0))
            if length > 1_000_000:
                raise ValueError("Payload too large")

            body = json.loads(self.rfile.read(length))
            params = body['params']

            # ВАЛИДАЦИЯ ДО СИМУЛЯЦИИ

            sim, metrics = get_engine()
            paths = sim(**params)
            result = metrics(paths)

            elapsed = (time.perf_counter() - start) * 1000

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Request-ID", request_id)
            self.send_header("X-Server-Timing", f"total;dur={elapsed:.0f}")
            self.end_headers()

            self.wfile.write(json.dumps({
                "data": result,
                "error": None,
                "meta": {
                    "schema_version": "2026-04",
                    "simulation_time_ms": round(elapsed),
                    "request_id": request_id,
                    "generated_at": datetime.utcnow().isoformat() + "Z"
                }
            }).encode())

        except Exception as e:
            elapsed = (time.perf_counter() - start) * 1000
            if "Payload too large" in str(e) or length > 1_000_000:
                code = "INVALID_PARAMS"
                msg = "Payload too large"
            elif isinstance(e, TimeoutError):
                code = "SIMULATION_TIMEOUT"
                msg = "Simulation timeout"
            else:
                code = "INTERNAL_ERROR"
                msg = "Internal server error"

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Request-ID", request_id)
            self.end_headers()
            self.wfile.write(json.dumps({
                "data": None,
                "error": {"code": code, "message": msg, "details": None, "retryable": False},
                "meta": {
                    "schema_version": "2026-04",
                    "simulation_time_ms": round(elapsed),
                    "request_id": request_id,
                    "generated_at": datetime.utcnow().isoformat() + "Z"
                }
            }).encode())
```

Anti-patterns

- Импорт simulate/compute_metrics на уровне модуля
- Возврат raw str(e) наружу
- Запуск симуляции без валидации

Edge cases

- Payload > 1 MB → INVALID_PARAMS
- n_simulations = 4000 + memory pressure
- Cold start + первый запрос

Definition of done

- Handler возвращает контракт data/error/meta и на успех, и на ошибку
- request_id и generated_at (ISO 8601) всегда присутствуют
- simulate и compute_metrics НЕ импортируются на момент импорта модуля (lazy)
- Нет raw exception messages наружу
