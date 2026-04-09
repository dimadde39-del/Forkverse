name: data-visualization
description: Spaghetti graph + percentile bands + fork summary. Самый важный UI-элемент ForkVerse. Recharts. Никаких компромиссов с математикой.

## Rule 0: Никогда не искажай математический смысл
Это не «красивая визуализация». Это приговор.

## Контракт данных (MonteCarloVisualization)
```ts
type MonteCarloVisualization = {
  percentiles: { p10: number[]; p50: number[]; p90: number[] };
  spaghettiSample: number[][];        // строго ≤ 50 путей
  forkSummary: Array<{ color: 'green' | 'yellow' | 'red'; pct: number; label: string }>;
  horizonMonths: number;
  startDate: string;                  // ISO 8601
  cashoutDateMedian?: string | null;
};
```

Validation Rules (выполнять перед рендером)

- Длины percentile-массивов === horizonMonths
- Каждый spaghettiSample[i].length ≤ horizonMonths
- p10[i] ≤ p50[i] ≤ p90[i] для каждой точки
- forkSummary суммарно 99.5–100.5%
- Отрицательные балансы разрешены

Компонент SpaghettiChart (production-ready v5)
(Код компонента остался идентичным v4, кроме одного изменения в cashoutMonth — теперь явно обрабатывает < startDate)

```tsx
// ... (тот же код, что в v4, только в cashoutMonth добавлено:
const cashoutMonth = useMemo(() => {
  if (!cashoutDateMedian) return null;
  const start = new Date(startDate);
  const cashout = new Date(cashoutDateMedian);
  if (cashout < start) {
    console.warn('cashoutDateMedian раньше startDate — clamp to month 1');
    return 1;
  }
  const monthsDiff = (cashout.getFullYear() - start.getFullYear()) * 12 + (cashout.getMonth() - start.getMonth());
  return monthsDiff + 1;
}, [cashoutDateMedian, startDate]);
```

Anti-patterns

- Представлять confidence band как две независимые серии (p10 и p90 должны быть одной Area-областью с градиентом)
- Рисовать > 50 spaghetti-линий
- Красить spaghetti ярче медианы
- Игнорировать отрицательные значения на оси Y

Edge cases

- Все балансы отрицательные
- cashoutDateMedian < startDate → clamp to month 1 + warning в консоль
- Один из массивов короче horizonMonths

Definition of done

- Chart проходит все Validation Rules
- Нет дорогих перерасчётов chartData и cashoutMonth на каждый render
- Tooltip usable на мобильных
- Отрицательная зона видна
- p10 ≤ p50 ≤ p90 в каждой точке
