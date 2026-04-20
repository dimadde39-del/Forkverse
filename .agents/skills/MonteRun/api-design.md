name: api-design
description: Жёсткий и единственный REST-контракт между Next.js и Python Monte-Carlo движком.

## Envelope (обязателен для всех Monte Carlo эндпоинтов)
```ts
type ApiErrorCode = 'SIMULATION_TIMEOUT' | 'INVALID_PARAMS' | 'RATE_LIMITED' | 'INTERNAL_ERROR';

type SimulationApiResponse = {
  data: SimulationResult | null;           // тип описан в monte-carlo-engine.md
  error: { code: ApiErrorCode | null; message: string; details: Record<string, unknown> | null; retryable: boolean } | null;
  meta: { 
    schema_version: '2026-04'; 
    simulation_time_ms: number; 
    request_id: string; 
    generated_at: string;   // ISO 8601
  };
};
```

Compatibility rule:
Все эндпоинты семейства Monte Carlo (/simulate, /recalculate, /patch и т.д.) обязаны возвращать ровно этот envelope.

Пример успешного ответа
```json
{
  "data": { "...": "полный результат из monte-carlo-engine" },
  "error": null,
  "meta": {
    "schema_version": "2026-04",
    "simulation_time_ms": 420,
    "request_id": "req_9k3m2x8p",
    "generated_at": "2026-04-09T12:23:45.123Z"
  }
}
```

Пример ответа с ошибкой
```json
{
  "data": null,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "initial_capital must be positive integer",
    "details": { "field": "initial_capital", "value": -50000 },
    "retryable": false
  },
  "meta": {
    "schema_version": "2026-04",
    "simulation_time_ms": 12,
    "request_id": "req_9k3m2x8p",
    "generated_at": "2026-04-09T12:23:45.123Z"
  }
}
```

Hard Rules

- Всегда 200 OK (осознанный компромисс для Vercel + единообразия).
- Units: integer тенге, ISO 8601 даты.
- Никогда не возвращать сырую матрицу (N, M).

Anti-patterns

- Разные HTTP-статусы для ошибок
- Разные shape ответов в разных эндпоинтах
- Возврат paths.tolist()

Edge cases

- n_simulations = 0 или 10000
- cashoutDateMedian = null

Definition of done

- Ответ полностью соответствует SimulationApiResponse
- Примеры успеха и ошибки валидируются против TS-типа
- request_id и generated_at всегда присутствуют
