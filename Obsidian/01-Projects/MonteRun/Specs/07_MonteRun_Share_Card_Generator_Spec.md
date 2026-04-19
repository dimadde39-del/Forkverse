# 07_MonteRun_Share_Card_Generator_Spec

Source: `C:\ForkVerse\07_MonteRun_Share_Card_Generator_Spec.docx`
Imported: 2026-04-18

MonteRun

Спецификация функции: Share Card Generator

Карточки результатов для сторис, постов и пересылки.

Документ

07_MonteRun_Share_Card_Generator_Spec

Статус

Draft v1.0

Назначение. Этот документ описывает одну конкретную функцию продукта MonteRun и фиксирует её цель, логику, интерфейс, правила, метрики и границы реализации для MVP.

1. Цель функции

Сделать shareable-артефакт, который выглядит дорого, передаёт суть результата за секунды и поддерживает виральность без превращения продукта в мем-помойку.

2. Дизайн-принцип

Премиальная ледяная подача: много воздуха, строгая типографика, почти банковская стерильность и одна хлёсткая строка вердикта.

3. Обязательные элементы карточки

• Главное число: runway или survival score.

• Контекст: base vs stress.

• Одна строка verdict.

• Название MonteRun или логотип.

• Optional: top lever или key stress loss.

4. Форматы

Формат

Назначение

Portrait 9:16

Stories

Square 1:1

Posts and messengers

Landscape 16:9

Screenshots / embeds

5. Tone constraints

• Карточка не должна содержать длинный текст.

• Brutal mode допустим, но без грубого clown-tone.

• Cold mode должен выглядеть как вывод из премиального терминала.

6. Технические требования

Требование

Почему

Fast render

Share action не должен ощущаться тяжёлым.

Deterministic layout

Нельзя, чтобы строки ломали композицию.

Safe truncation

Длинный verdict нужно сокращать без потери смысла.
