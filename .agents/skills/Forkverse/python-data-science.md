name: python-data-science
description: Высокопроизводительный Monte Carlo движок ForkVerse. Векторизация, default_rng, серверная агрегация. Никогда не шлёшь сырые матрицы клиенту.

## Rule 0: Vectorize Everything
Все N симуляций — матричные операции. Циклы по месяцам и streams — вынужденный минимум, но внутри — только векторизация.

## Rule 1: Только default_rng()
Все random-вызовы — строго через `rng = np.random.default_rng(seed=...)`

## Hard Rules
- n_simulations всегда clamp: `n = min(params.get("n_simulations", 4000), 4000)`
- compute_metrics() **никогда** не нарушает envelope из api-design.md (data/error/meta)
- compute_patch_impact() работает только с envelope-ответами

**Anti-patterns**
- Python loops вместо NumPy векторизации
- np.random.* вместо default_rng()
- paths.tolist() или любая сырая матрица на клиент
- max(capital, 0) внутри симуляции
- pandas в hot path

**Edge cases**
- Все income_streams = 0
- initial_capital = 0
- n_simulations = 0 или 10000
- horizon_months = 1 или 24+

**Definition of done**
- Всё через default_rng
- n_simulations clamped
- Нет сырых матриц в ответе
- compute_metrics и compute_patch_impact возвращают полный data/error/meta envelope
- Локально < 900 мс на 4000 симуляций
- Тесты с фиксированным seed проходят determinism
