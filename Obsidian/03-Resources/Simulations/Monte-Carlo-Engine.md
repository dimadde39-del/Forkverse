# Monte-Carlo-Engine

Backlinks: [[ForkVerse MOC]] · [[01-Projects/ForkVerse/Current-Status]] · [[03-Resources/Architecture/Parser-and-Simulation-Flow]] · [[03-Resources/MOC]]

## Purpose
Эта заметка фиксирует, как ForkVerse считает runway после парсинга сценария.

## Key Behaviors
- `income_delay_months` обнуляет monthly income на первых N месяцах.
- Доход и burn получают отдельный multiplicative noise.
- После первого `capital <= 0` траектория замораживается на нуле.
- На выходе формируются percentiles и `spaghetti_sample` для графика.

## Simulation Flow
```mermaid
flowchart LR
    A[Parsed params] --> B[income_delay_months gate]
    B --> C[Income noise path]
    B --> D[Burn noise path]
    C --> E[Monthly delta]
    D --> E
    E --> F[Cumulative capital]
    F --> G[Absorbing barrier at 0]
    G --> H[Percentiles and spaghetti sample]
```

## Connected Context
- Project overview: [[ForkVerse MOC]]
- Current state: [[01-Projects/ForkVerse/Current-Status]]
- API contract path: [[03-Resources/Architecture/Parser-and-Simulation-Flow]]
- Design context: [[03-Resources/Design/emil-design-eng]]
