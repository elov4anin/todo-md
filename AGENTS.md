# AGENTS.md — правила для AI-агентов

Правила для AI-агентов (Codex, OpenCode, Roo, Kilo, Pi и др.) по работе с данным пакетом.

---

## Проект

**elov4anin/todo-md** — TypeScript/Node.js CLI: file-based kanban board для управления задачами в markdown-файлах с YAML front matter.

Пакет подключается к проекту-потребителю как Git dependency через npm и запускается командой `npx todo-md`.

### Состав

1. **CLI `dist/bin/todo-md.js`** — единая точка входа, диспетчер подкоманд: `init`, `create`, `start`, `review`, `done`, `cancel`, `backlog`, `set`, `validate`, `export-jsonl`, `dashboard`.
2. **Документация** (`docs/todo-md/`) — конвенции, справочники, шаблоны задач и эпиков, копируемые командой `init`.

---

## Перед каждым пушем / PR

- **Локально:** `npm run check` — typecheck + тесты + сборка + smoke-проверка.
- После изменения `src/` коммитить синхронно обновлённый `dist/` (`npm run compile`).
- **CI** запускается автоматически при пуше/PR (`.github/workflows/ci.yml` → `npm run check`).

---

## Принципы работы с кодом

- **Node.js 24 LTS**, TypeScript, `strict: true`.
- **Git delivery**: готовый `dist/` входит в Git; lifecycle-скрипты npm запрещены.
- **Читаемость** важнее производительности. Осмысленные имена, минимальная вложенность.
- **Стабильность**: init-скрипт должен быть обратно совместим — проекты-потребители не должны ломаться при обновлении.

---

## Структура пакета

```text
src/                         # TypeScript-исходники
  bin/todo-md.ts             # CLI entry point
  parser.ts                  # Front matter, пути, ссылки
  validator.ts               # Валидация задач и эпиков
  board.ts                   # Переходы, link rewriting, rollback
  cli.ts                     # Диспетчер подкоманд
dist/                        # Скомпилированный JS, хранится в Git
assets/                      # Init-файлы, HTML-шаблон, Chart.js bundle
docs/
  todo-md/                   # Документация, копируемая в проект-потребитель
    AGENTS.md                # Правила работы с задачами (для AI-агентов потребителя)
    AGENTS_TASK_WRITING_GUIDE.md
    reference/               # Справочники: TYPES, STATUSES, VALUES, COMPLEXITY, PRIORITIES, COST, AI_AGENTS, GLOSSARY
    templates/               # Шаблоны: task.md, epic.md
tests/                       # node:test integration/contract tests
todo/                        # Внутренние задачи по доработке пакета
```

---
## Правила написания документации

### Язык и стиль

- **Русский** с английским термином в скобках при первом упоминании.
- Формулировки как «пули» — короткие, чёткие, без воды.
- Каждый документ описывает **один подход** или **одну сущность**.

### Форматирование

- **Markdown** для всех документов.
- **Запрещён псевдокод** — только реальные примеры.
- Кодовые блоки с указанием языка.

---

## Команда `init` (`todo-md init`)

### Ключевые принципы

- **Idempotent** — повторный запуск безопасен, существующие файлы не перезаписываются (кроме `--force`).
- **Минимальные runtime-зависимости** — только Node.js 24; готовый пакет не собирается при установке.
- **Аргументы**: `[target-dir]`, `--docs-path=<path>`, `--agents-path=<path>`, `--force`.

### Что делает

1. Создаёт `todo/`, `todo/backlog/`, `todo/done/`, `todo/cancelled/` (с `.gitkeep`).
2. Копирует `docs/todo-md/` в проект-потребитель (без `AGENTS.md`).
3. Копирует `AGENTS.md` отдельно в `todo/AGENTS.md`.
4. Обновляет `.gitignore` в `docs/` и `todo/`.

---

## Задачи по доработке пакета

Внутренние задачи хранятся в `todo/` в формате пакета (TASK-*.todo.md). Это задачи по развитию документации, шаблонов и init-скрипта.

---

## Git workflow

Правила работы с git — ветки, коммиты, PR, релизы, SemVer:

- [Ветки](vendor/elov4anin/git-workflow/docs/git-workflow/branches.md)
- [Коммиты (Conventional Commits)](vendor/elov4anin/git-workflow/docs/git-workflow/commits.md)
- [Pull Request](vendor/elov4anin/git-workflow/docs/git-workflow/pull-request.md)
- [Code Review](vendor/elov4anin/git-workflow/docs/git-workflow/code-review.md)
- [Релизы и CHANGELOG](vendor/elov4anin/git-workflow/docs/git-workflow/release.md)

---

## Ссылки

- **README**: [README.md](README.md)
- **Документация пакета**: [docs/todo-md/](docs/todo-md/)
- **AGENTS.md (для потребителя)**: [docs/todo-md/AGENTS.md](docs/todo-md/AGENTS.md)
- **Справочники**: [docs/todo-md/reference/](docs/todo-md/reference/)
- **Шаблоны**: [docs/todo-md/templates/](docs/todo-md/templates/)
- **CLI**: [bin/todo-md](bin/todo-md)
