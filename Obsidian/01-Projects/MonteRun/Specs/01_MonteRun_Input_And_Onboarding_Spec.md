# 01_MonteRun_Input_And_Onboarding_Spec

Source: `C:\ForkVerse\01_MonteRun_Input_And_Onboarding_Spec.docx`
Imported: 2026-04-18

Current launch-hardening status: updated 2026-05-01.

MonteRun

Спецификация функции: Input & Onboarding

Первичный ввод данных и первый verdict.

Документ

01_MonteRun_Input_And_Onboarding_Spec

Статус

Draft v1.0

Назначение. Этот документ описывает одну конкретную функцию продукта MonteRun и фиксирует её цель, логику, интерфейс, правила, метрики и границы реализации для MVP.

1. Цель функции

Собрать минимально достаточные финансовые данные так, чтобы пользователь получил первый сильный verdict менее чем за 60 секунд, без обучения и без ощущения, что он заполняет бухгалтерскую форму.

Launch reality: the parser path is now hardened for fast extraction with a sub-10-second target. It must return compact raw JSON only, without chain-of-thought, markdown, analysis, or explanatory prose. The LLM parses facts and short phrasing only; deterministic code owns all math.

2. Пользовательская ценность

• Понять, какие данные нужны для расчёта runway.

• Быстро увидеть первый результат без долгой анкеты.

• Получить ощущение точности без когнитивной перегрузки.

3. Входные поля MVP

Поле

Правило

Cash on hand

Обязательное. Текущий объём доступной подушки.

Monthly income

Обязательное. Средний доход за месяц. Для нестабильного дохода можно указать диапазон.

Fixed expenses

Обязательное. Повторяющиеся обязательные расходы.

Debt obligations

Опционально, но рекомендовано. Сумма ежемесячных платежей по долгам.

One-time expected expense

Опционально. Разовый удар, который пользователь уже ожидает.

Unstable income toggle

Опционально. Включает дополнительные stress assumptions.

4. UX-принципы

• Один экран ввода или два коротких шага максимум.

• Ни одного термина, требующего финансовой подготовки.

• Подсказки должны объяснять поле, а не читать лекцию.

• Пустые поля не должны ронять сценарий. Нужны безопасные defaults только там, где это честно.

5. Валидация

Случай

Поведение системы

Доход < расходы при нулевой подушке

Показывать результат без блокировки. Жёсткий verdict допустим.

Ноль или пустое значение

Подсветить поле и объяснить, зачем оно нужно.

Слишком большие числа

Разрешать, но проверять формат и единицы измерения.

Доход как диапазон

Сохранять lower / base / upper для stress mode.

6. Интерфейс первого результата

После отправки формы пользователь должен попасть сразу на главный экран с runway, base vs stress, levers и verdict. Никаких промежуточных “почти готово” экранов, если расчёт укладывается в SLA.

Current launch SLA: the first parse/extraction should feel immediate enough for launch smoke tests. Any response that exposes LLM reasoning, formulas, or prose outside JSON is a parser bug, not acceptable product behavior.

7. Не делаем в MVP

• Длинные анкеты о целях, темпераменте и risk profile.

• Импорт банковских данных.

• Распознавание чеков.

• Попытки предсказывать карьеру или инвестиционные рынки.
