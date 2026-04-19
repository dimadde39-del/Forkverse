# 11_MonteRun_White_Label_Readiness_Spec

Source: `C:\ForkVerse\11_MonteRun_White_Label_Readiness_Spec.docx`
Imported: 2026-04-18

MonteRun

Спецификация функции: White-Label Readiness

Готовность ядра к будущему B2B без отвлечения от MVP.

Документ

11_MonteRun_White_Label_Readiness_Spec

Статус

Draft v1.0

Назначение. Этот документ описывает одну конкретную функцию продукта MonteRun и фиксирует её цель, логику, интерфейс, правила, метрики и границы реализации для MVP.

1. Цель функции

Сохранить архитектурную возможность продавать ядро как neutral scenario engine в будущем, не начиная B2B-ветку раньше времени.

2. Принцип

White-label readiness - это не отдельный продукт в MVP, а требование к чистоте интерфейсов и разделению слоёв.

3. Что должно быть отделено уже сейчас

Слой

Требование

Math core

Независим от tone mode и UI.

Scenario engine

Отдаёт structured data, пригодные для consumer UI и B2B.

Tone layer

Легко отключается или меняется на neutral.

Share layer

Не обязателен для white-label use case.

4. Что не делаем сейчас

• Продажи банкам.

• Enterprise dashboard.

• Custom SLAs, roles and permissions.

• Отдельный compliance-heavy контур.

5. Почему это всё равно полезно

Если слои будут отделены с самого начала, продукт позже сможет выйти в B2B без переписывания движка и без удаления consumer brand voice из ядра.
