---
package: prikotov/todo-md
---

# Конфигурация пакета (.todo-md.json)

Опциональный конфиг `todo-md` в корне проекта, рядом с директорией `todo/`.
Команда `npx todo-md init` создаёт его автоматически.

Путь можно указать явно:

```bash
npx todo-md validate --config=path/to/.todo-md.json
```

## Формат

```json
{
  "$schema": "./node_modules/@prikotov/todo-md/schemas/config.schema.json",
  "roles": ["Бэкендер", "Фронтендер", "Аналитик", "Архитектор"],
  "agents": ["codex-cli", "codex", "pi", "kilocode"],
  "strict": false
}
```

- `roles` — допустимые роли перед скобками в `author` и `assignee`. Пустой список разрешает любую роль правильного формата.
- `agents` — допустимые lowercase-идентификаторы агентов. Пустой список включает пакетный список из [AI_AGENTS.md](./AI_AGENTS.md).
- `strict` — преобразует нарушения `author`/`assignee` из предупреждений в ошибки.

Заполненное значение `author` или `assignee` имеет формат `<роль> (<агент>)`,
например `Бэкендер (codex-cli)`. `assignee` обязателен для `in_progress`,
`paused`, `blocked`, `review` и `done`.

Невалидный JSON считается ошибкой конфигурации. PHP-конфиги не поддерживаются и
не исполняются.
