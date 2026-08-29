import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { create, resolveRoot, setFields, transition } from "./board.js";
import { loadConfig, loadConfigFile } from "./config.js";
import { TodoMdError } from "./domain.js";
import { renderDashboard } from "./dashboard.js";
import { extractRecord, recordsToJsonl } from "./export.js";
import { initProject } from "./init.js";
import { buildIdIndex, findTodoFiles, makeRelativePath } from "./parser.js";
import { validateFile } from "./validator.js";
const PROCESS_IO = {
    cwd: () => process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    stdin: () => readFileSync(0, "utf8"),
};
export function main(argv, io = PROCESS_IO) {
    const command = argv[0] ?? "";
    const args = argv.slice(1);
    if (command === "" || command === "--help" || command === "-h") {
        io.stdout(ROOT_HELP);
        return 0;
    }
    try {
        switch (command) {
            case "init": return commandInit(args, io);
            case "create": return commandCreate(args, io);
            case "start": return commandTransition(args, io, "in_progress", "start");
            case "review": return commandTransition(args, io, "review", "review");
            case "done": return commandTransition(args, io, "done", "done");
            case "cancel": return commandTransition(args, io, "cancelled", "cancel");
            case "backlog": return commandTransition(args, io, "backlog", "backlog");
            case "set": return commandSet(args, io);
            case "validate": return commandValidate(args, io);
            case "export-jsonl": return commandExport(args, io);
            case "dashboard": return commandDashboard(args, io);
            default:
                io.stderr(`Error: unknown command "${command}".\n`);
                io.stdout(ROOT_HELP);
                return 1;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.stderr(`${error instanceof TodoMdError ? "Error" : "Fatal"}: ${message}\n`);
        return 1;
    }
}
function parseArgs(args, valueOptions = new Set()) {
    const parsed = { values: [], options: {}, flags: new Set() };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] ?? "";
        if (arg.startsWith("--")) {
            const body = arg.slice(2);
            const equal = body.indexOf("=");
            if (equal >= 0)
                parsed.options[body.slice(0, equal)] = body.slice(equal + 1);
            else if (valueOptions.has(body) && args[index + 1] !== undefined) {
                parsed.options[body] = args[index + 1] ?? "";
                index += 1;
            }
            else
                parsed.flags.add(body);
        }
        else if (arg.startsWith("-") && arg.length > 1 && arg !== "-") {
            parsed.flags.add(arg.slice(1));
        }
        else
            parsed.values.push(arg);
    }
    return parsed;
}
function commandInit(args, io) {
    const parsed = parseArgs(args, new Set(["docs-path", "agents-path"]));
    if (hasHelp(parsed))
        return showHelp(io, INIT_HELP);
    rejectUnknown(parsed, new Set(["force"]), new Set(["docs-path", "agents-path"]));
    const target = parsed.values[0] ?? io.cwd();
    if (parsed.values.length > 1)
        throw new TodoMdError(`unexpected argument: ${parsed.values[1]}`);
    const options = {};
    if (parsed.flags.has("force"))
        options.force = true;
    if (parsed.options["docs-path"] !== undefined)
        options.docsPath = parsed.options["docs-path"];
    if (parsed.options["agents-path"] !== undefined)
        options.agentsPath = parsed.options["agents-path"];
    const result = initProject(target, options);
    io.stdout(`${result.lines.join("\n")}\n`);
    return 0;
}
function commandCreate(args, io) {
    const parsed = parseArgs(args, CREATE_OPTIONS);
    if (hasHelp(parsed))
        return showHelp(io, CREATE_HELP);
    rejectUnknown(parsed, new Set(), CREATE_OPTIONS);
    const id = parsed.values[0];
    if (!id)
        return usageError(io, "Error: task/epic ID required.\n", CREATE_HELP);
    const author = parsed.options.author;
    if (!author?.trim())
        return usageError(io, "Error: --author=<role> is required.\n", CREATE_HELP);
    const root = resolveRoot(parsed.options.root ?? io.cwd());
    io.stdout(`${create(root, id, {
        ...(parsed.options.type !== undefined ? { type: parsed.options.type } : {}),
        ...(parsed.options.title !== undefined ? { title: parsed.options.title } : {}),
        ...(parsed.options.value !== undefined ? { value: parsed.options.value } : {}),
        ...(parsed.options.complexity !== undefined ? { complexity: parsed.options.complexity } : {}),
        ...(parsed.options.priority !== undefined ? { priority: parsed.options.priority } : {}),
        author,
        ...(parsed.options.status !== undefined ? { status: parsed.options.status } : {}),
        ...(parsed.options.epic !== undefined ? { epic: parsed.options.epic } : {}),
        ...(parsed.options["depends-on"] !== undefined ? { depends_on: parsed.options["depends-on"] } : {}),
    })}\n`);
    return 0;
}
function commandTransition(args, io, status, verb) {
    const parsed = parseArgs(args, new Set(["assignee", "root"]));
    if (hasHelp(parsed))
        return showHelp(io, transitionHelp(verb, status));
    rejectUnknown(parsed, new Set(), new Set(["assignee", "root"]));
    const id = parsed.values[0];
    if (!id)
        return usageError(io, "Error: task ID required.\n", transitionHelp(verb, status));
    if (verb === "start" && !parsed.options.assignee?.trim()) {
        return usageError(io, "Error: --assignee=<role> is required for 'start'.\n", transitionHelp(verb, status));
    }
    const root = resolveRoot(parsed.options.root ?? io.cwd());
    const options = parsed.options.assignee !== undefined ? { assignee: parsed.options.assignee } : {};
    io.stdout(`${transition(root, id, status, options)}\n`);
    return 0;
}
function commandSet(args, io) {
    const parsed = parseArgs(args, new Set(["root"]));
    if (hasHelp(parsed))
        return showHelp(io, SET_HELP);
    rejectUnknown(parsed, new Set(), new Set(["root"]));
    const id = parsed.values[0];
    if (!id || parsed.values.length < 2) {
        return usageError(io, "Error: usage: todo-md set <ID> <field>=<value> [field=value ...]\n", SET_HELP);
    }
    const assignments = {};
    for (const assignment of parsed.values.slice(1)) {
        const equal = assignment.indexOf("=");
        if (equal <= 0)
            return usageError(io, `Error: arguments after <ID> must be <field>=<value>, got: ${assignment}\n`, SET_HELP);
        const field = assignment.slice(0, equal);
        const value = assignment.slice(equal + 1);
        if (assignments[field] !== undefined && assignments[field] !== value) {
            io.stderr(`Error: conflicting values for field \`${field}\`: ${assignments[field]} vs ${value}\n`);
            return 1;
        }
        assignments[field] = value;
    }
    const root = resolveRoot(parsed.options.root ?? io.cwd());
    io.stdout(`${setFields(root, id, assignments)}\n`);
    return 0;
}
function commandValidate(args, io) {
    const parsed = parseArgs(args, new Set(["config"]));
    if (hasHelp(parsed))
        return showHelp(io, VALIDATE_HELP);
    rejectUnknown(parsed, new Set(["strict"]), new Set(["config"]));
    const targets = parsed.values.length > 0 ? parsed.values : [io.cwd()];
    const files = [...new Set(targets.flatMap(findTodoFiles))].sort();
    if (files.length === 0) {
        io.stdout("No .todo.md files found.\n");
        return 0;
    }
    let idFiles = [...files];
    try {
        const root = resolveRoot(io.cwd());
        idFiles = [...new Set([...idFiles, ...findTodoFiles(root)])];
    }
    catch {
        try {
            const root = resolveRoot(files[0] ?? io.cwd());
            idFiles = [...new Set([...idFiles, ...findTodoFiles(root)])];
        }
        catch { /* standalone file */ }
    }
    let config;
    if (parsed.options.config)
        config = loadConfigFile(parsed.options.config);
    else {
        let configRoot = null;
        try {
            configRoot = resolveRoot(io.cwd());
        }
        catch { /* standalone target */ }
        config = configRoot ? loadConfig(configRoot) : { roles: [], agents: [], strict: false };
    }
    if (parsed.flags.has("strict"))
        config = { ...config, strict: true };
    const index = buildIdIndex(idFiles);
    let errorCount = 0;
    let warningCount = 0;
    for (const file of files) {
        const result = validateFile(file, index, config);
        errorCount += result.errors.length;
        warningCount += result.warnings.length;
        const relative = makeRelativePath(file, io.cwd());
        if (result.errors.length === 0 && result.warnings.length === 0)
            io.stdout(`✓ ${relative}\n`);
        else {
            io.stdout(`${result.errors.length === 0 ? "!" : "✗"} ${relative}\n`);
            for (const error of result.errors)
                io.stdout(`  error: ${error}\n`);
            for (const warning of result.warnings)
                io.stdout(`  warning: ${warning}\n`);
        }
    }
    io.stdout(`\nValidated ${files.length} file(s): ${errorCount} error(s), ${warningCount} warning(s).\n`);
    return errorCount > 0 ? 1 : 0;
}
function commandExport(args, io) {
    const parsed = parseArgs(args, new Set(["output"]));
    if (parsed.flags.has("o")) {
        const index = args.indexOf("-o");
        const output = index >= 0 ? args[index + 1] : undefined;
        if (output)
            parsed.options.output = output;
        parsed.values = parsed.values.filter((value) => value !== args[index + 1]);
        parsed.flags.delete("o");
    }
    if (hasHelp(parsed))
        return showHelp(io, EXPORT_HELP);
    rejectUnknown(parsed, new Set(), new Set(["output"]));
    const targets = parsed.values.length > 0 ? parsed.values : [io.cwd()];
    const files = [...new Set(targets.flatMap(findTodoFiles))].sort();
    if (files.length === 0) {
        io.stderr("No .todo.md files found.\n");
        return 0;
    }
    const output = recordsToJsonl(files.map((file) => extractRecord(file, io.cwd())).filter(isRecord));
    if (parsed.options.output)
        writeFileSync(parsed.options.output, output);
    else
        io.stdout(output);
    return 0;
}
function commandDashboard(args, io) {
    const normalized = normalizeShortOutput(args);
    const parsed = parseArgs(normalized, new Set(["output", "title", "base"]));
    if (hasHelp(parsed))
        return showHelp(io, DASHBOARD_HELP);
    rejectUnknown(parsed, new Set(), new Set(["output", "title", "base"]));
    const input = parsed.values[0];
    let records;
    if (!input || (input !== "-" && existsSync(input) && statSync(input).isDirectory())) {
        const files = findTodoFiles(input ?? io.cwd()).sort();
        records = files.map((file) => extractRecord(file, io.cwd())).filter(isRecord);
    }
    else {
        const raw = input === "-" ? io.stdin() : readFileSync(input, "utf8");
        records = [];
        for (const line of raw.trim().split(/\r\n|\r|\n/u)) {
            if (!line)
                continue;
            try {
                records.push(JSON.parse(line));
            }
            catch {
                io.stderr("Warning: skipping invalid JSON line\n");
            }
        }
    }
    const html = renderDashboard(records, parsed.options.title ?? "Задачи", parsed.options.base);
    if (parsed.options.output) {
        writeFileSync(parsed.options.output, html);
        io.stderr(`Wrote ${parsed.options.output} (${records.length} task(s)).\n`);
    }
    else
        io.stdout(html);
    return 0;
}
function normalizeShortOutput(args) {
    return args.flatMap((arg, index) => arg === "-o" && args[index + 1] !== undefined ? ["--output"] : index > 0 && args[index - 1] === "-o" ? [arg] : [arg]);
}
function hasHelp(parsed) {
    return parsed.flags.has("help") || parsed.flags.has("h");
}
function rejectUnknown(parsed, flags, options) {
    for (const flag of parsed.flags)
        if (!flags.has(flag) && flag !== "help" && flag !== "h") {
            throw new TodoMdError(`unknown option: --${flag}`);
        }
    for (const option of Object.keys(parsed.options))
        if (!options.has(option)) {
            throw new TodoMdError(`unknown option: --${option}`);
        }
}
function showHelp(io, help) { io.stdout(help); return 0; }
function usageError(io, error, help) { io.stderr(error); io.stdout(help); return 1; }
function isRecord(record) { return record !== null; }
const CREATE_OPTIONS = new Set(["type", "title", "value", "complexity", "priority", "author", "status", "epic", "depends-on", "root"]);
const ROOT_HELP = `todo-md — file-based kanban board for markdown tasks.\n\nUsage:\n  todo-md <command> [options]\n\nCommands:\n  init          Initialise a todo/ board in the current project\n  create        Create a new task or epic\n  start         Move task/epic to in_progress\n  review        Move task/epic to review\n  done          Move task/epic to done (done/)\n  cancel        Move task/epic to cancelled (cancelled/)\n  backlog       Move task/epic to backlog (backlog/)\n  set           Edit a front-matter field\n  validate      Validate task and epic files\n  export-jsonl  Export metadata as JSON Lines\n  dashboard     Render HTML dashboard from JSONL\n\nRun \`todo-md <command> --help\` for command-specific help.\n\n`;
const INIT_HELP = `todo-md init — initialise a todo/ kanban board in the current project.\n\nUsage:\n  todo-md init [target-dir] [--docs-path=<path>] [--agents-path=<path>] [--force]\n\n  target-dir    — project root (default: current working directory).\n  --docs-path   — relative path where docs will be copied (default: docs/todo-md).\n  --agents-path — relative path where AGENTS.md will be copied (default: todo/AGENTS.md).\n  --force       — overwrite existing files with fresh copies from the package.\n`;
const CREATE_HELP = `todo-md create — create a new task or epic.\n\nUsage:\n  todo-md create <ID> --type=<type> --author=<role> [options]\n\nOptions:\n  --type=<type>        Task type (required for tasks).\n  --title=<title>      H1 title (default: derived from ID).\n  --value=<V0-V4>      Business value (default: V2).\n  --complexity=<C0-C5> Complexity (default: C2).\n  --priority=<P0-P3>   Priority (default: P2).\n  --author=<author>    Author role (required).\n  --status=<status>    Initial status (default: todo).\n  --epic=<EPIC-ID>     Epic this task belongs to.\n  --depends-on=<ids>   Comma-separated plain IDs.\n  --root=<path>        Project root (default: current directory).\n  --help               Show this help.\n\nLayout:\n  EPIC-x               → todo/<zone>/EPIC-x/EPIC-x.todo.md\n  TASK-y --epic=EPIC-x → todo/<zone>/EPIC-x/TASK-y.todo.md\n  TASK-y               → todo/<zone>/TASK-y.todo.md\n`;
function transitionHelp(verb, status) {
    return `todo-md ${verb} — move a task/epic to status \`${status}\`.\n\nUsage:\n  todo-md ${verb} <ID> [--assignee=<role>] [--root=<path>]\n\nAtomically sets status, moves the file while preserving its EPIC-* directory, rewrites links, and validates.\nOn validation failure all changes are rolled back.\n`;
}
const SET_HELP = `todo-md set — point-edit front-matter fields.\n\nUsage:\n  todo-md set <ID> <field>=<value> [field=value ...] [--root=<path>]\n\nIf field is \`status\`, the full transition runs and it must be the only assignment.\nSetting or clearing \`epic\` atomically moves a task to its canonical directory and rewrites links.\n`;
const VALIDATE_HELP = `todo-md validate — validate todo-md task and epic files.\n\nUsage:\n  todo-md validate [target-dir|file ...]\n\nOptions:\n  --strict        Treat actor warnings as errors.\n  --config=FILE   Config file (default: <project-root>/.todo-md.json).\n  --help          Show this help.\n`;
const EXPORT_HELP = `todo-md export-jsonl — export metadata as JSON Lines.\n\nUsage:\n  todo-md export-jsonl [target-dir|file ...] [-o FILE]\n`;
const DASHBOARD_HELP = `todo-md dashboard — render a self-contained HTML dashboard.\n\nUsage:\n  todo-md dashboard [todo-dir|-|input.jsonl] [-o out.html] [--title="..."] [--base=DIR]\n`;
//# sourceMappingURL=cli.js.map