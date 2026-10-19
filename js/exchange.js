// Обмен с Claude и бэкап: разбор пакета, превью, применение, откат, пакеты, выгрузка.
// Схема пакета описана в docs/claude-format.md — менять их вместе.
import { getMeta, setMeta } from "./db.js";
import { addDays, parseDate, shiftDays, toIso } from "./dates.js";
import { discardTask, newTask, putTasks, restoreTask, setLists, state, trashTask } from "./store.js";

export const FORMAT_VERSION = 1;

const ENERGY = { high: "high", mid: "mid", medium: "mid", low: "low" };
const KINDS = ["task", "post", "show"];
const UNITS = ["day", "week", "month"];
const WEEKDAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];
const SHOW_TEXT = ["client", "phone", "address", "format"];

// ---- чтение текста: файл, буфер, ответ Claude с ```json и словами вокруг ----
export function readPackage(text) {
    const clean = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let data;
    try {
        data = JSON.parse(clean);
    } catch (e) {
        // из чата часто копируют вместе с пояснениями: берём от первой скобки до последней
        const from = clean.search(/[{[]/);
        const to = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
        try {
            data = JSON.parse(clean.slice(from, to + 1));
        } catch (e2) {
            throw new Error("Это не похоже на файл для плана. Скопируй JSON целиком, от { до }.");
        }
    }
    if (Array.isArray(data)) {
        data = { items: data };
    }
    if (data?.app === "plan" && data.backup) {
        if (!Array.isArray(data.tasks) || !Array.isArray(data.lists)) {
            throw new Error("Бэкап повреждён: нет задач или списков.");
        }
        return { backup: data };
    }
    const version = data?.version ?? 1;
    if (version > FORMAT_VERSION) {
        throw new Error(`Файл версии ${version}, а приложение понимает до ${FORMAT_VERSION}. Обнови приложение.`);
    }
    if (!Array.isArray(data?.items)) {
        throw new Error("В файле нет списка задач items.");
    }
    return { batch: typeof data.batch === "string" && data.batch.trim() ? data.batch.trim() : null, items: data.items };
}

// ---- поля одной задачи ----
function readDate(value, name, warn) {
    if (value === null || value === "") {
        return null;
    }
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(parseDate(value))) {
        return value;
    }
    // момент без поправки («2026-11-03T19:00») — время телефона
    const date = typeof value === "string" ? new Date(value) : null;
    if (!date || isNaN(date)) {
        warn(`${name}: «${value}» не дата`);
        return undefined;
    }
    return toIso(date);
}

function readRepeat(value, warn) {
    if (value === null) {
        return null;
    }
    const unit = value?.unit;
    if (!UNITS.includes(unit)) {
        warn("repeat: unit должен быть day, week или month");
        return undefined;
    }
    const repeat = { unit, every: Math.max(1, Math.round(+value.every || 1)) };
    if (unit === "week" && Array.isArray(value.weekdays)) {
        const days = value.weekdays.map(day => String(day).toLowerCase().slice(0, 2)).filter(day => WEEKDAYS.includes(day));
        if (days.length) {
            repeat.weekdays = WEEKDAYS.filter(day => days.includes(day));
        }
    }
    if (unit === "month" && +value.monthDay >= 1 && +value.monthDay <= 31) {
        repeat.monthDay = Math.round(+value.monthDay);
    }
    return repeat;
}

function readShow(value) {
    if (value === null || typeof value !== "object") {
        return null;
    }
    const show = {};
    SHOW_TEXT.forEach(key => typeof value[key] === "string" && value[key].trim() && (show[key] = value[key].trim()));
    if (value.fee !== undefined && value.fee !== null && value.fee !== "") {
        show.fee = isNaN(+value.fee) ? String(value.fee) : +value.fee;
    }
    if (+value.travelMin > 0) {
        show.travelMin = Math.round(+value.travelMin);
    }
    return Object.keys(show).length ? show : null;
}

// список по имени (или id) без учёта регистра; неизвестный — новый список
function listId(value, ctx) {
    if (value === null || value === "") {
        return null;
    }
    const name = String(value).trim();
    const lower = name.toLowerCase();
    const found = [...state.lists, ...ctx.newLists].find(list => list.name.toLowerCase() === lower || list.id === name);
    if (found) {
        return found.id;
    }
    const order = Math.max(0, ...state.lists.map(list => list.order), ...ctx.newLists.map(list => list.order)) + 1;
    const list = { id: "l-" + crypto.randomUUID().slice(0, 6), name, order, shared: false };
    ctx.newLists.push(list);
    return list.id;
}

// только поля, которые есть в файле: остальное у существующей задачи не трогаем
function readFields(raw, ctx, warn) {
    const fields = { title: raw.title.trim() };
    const has = key => Object.prototype.hasOwnProperty.call(raw, key);
    if (has("kind")) {
        KINDS.includes(raw.kind) ? fields.kind = raw.kind : warn(`kind: «${raw.kind}» не знаю`);
    }
    if (has("list")) {
        fields.list = listId(raw.list, ctx);
    }
    ["plannedAt", "start", "due"].forEach(key => {
        if (has(key)) {
            const value = readDate(raw[key], key, warn);
            if (value !== undefined) {
                fields[key] = key === "start" && value ? value.slice(0, 10) : value;
            }
        }
    });
    if (has("durationMin")) {
        fields.durationMin = +raw.durationMin > 0 ? Math.round(+raw.durationMin) : null;
    }
    if (has("energy")) {
        fields.energy = ENERGY[raw.energy] || null;
    }
    if (has("priority")) {
        fields.priority = raw.priority === "high" ? "high" : "normal";
    }
    if (has("persistent")) {
        fields.persistent = !!raw.persistent;
    }
    if (has("tags")) {
        fields.tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
    }
    if (has("notes")) {
        fields.notes = raw.notes == null ? "" : String(raw.notes);
    }
    if (has("checklist")) {
        fields.checklist = (Array.isArray(raw.checklist) ? raw.checklist : [])
            .map(step => typeof step === "string" ? { text: step, done: false } : { text: String(step?.text ?? ""), done: !!step?.done })
            .filter(step => step.text.trim());
    }
    if (has("status")) {
        fields.status = raw.status == null ? null : String(raw.status);
    }
    if (has("repeat")) {
        const repeat = readRepeat(raw.repeat, warn);
        if (repeat !== undefined) {
            fields.repeat = repeat;
        }
    }
    if (has("show")) {
        fields.show = readShow(raw.show);
    }
    return fields;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const FIELD_NAMES = {
    title: "название", kind: "тип", list: "список", plannedAt: "когда", start: "не раньше", due: "дедлайн",
    durationMin: "длительность", energy: "энергия", priority: "важность", persistent: "настойчивость", tags: "метки",
    notes: "заметки", checklist: "шаги", status: "стадия", repeat: "повтор", show: "выступление"
};

// ---- превью: что добавится, обновится, конфликтует ----
// row.type: add | update | conflict | same | skip
export function preparePackage(pkg) {
    const ctx = { newLists: [] };
    const rows = [];
    const seen = new Set();

    pkg.items.forEach((raw, index) => {
        const label = `№${index + 1}`;
        if (!raw || typeof raw !== "object" || typeof raw.title !== "string" || !raw.title.trim()) {
            rows.push({ type: "skip", title: raw?.id ? String(raw.id) : label, reason: "нет названия (title)" });
            return;
        }
        const id = raw.id != null && String(raw.id).trim() ? String(raw.id).trim() : null;
        if (id && seen.has(id)) {
            rows.push({ type: "skip", title: raw.title, reason: `id «${id}» повторяется в файле` });
            return;
        }
        id && seen.add(id);
        const warnings = [];
        const fields = readFields(raw, ctx, text => warnings.push(text));
        const before = id ? state.tasks.get(id) : null;

        if (!before) {
            const done = !!raw.done;
            rows.push({
                type: "add", warnings,
                task: newTask({ ...fields, ...(id && { id }), batch: pkg.batch, done, doneAt: done ? toIso(new Date()) : null, imported: fields })
            });
            return;
        }
        // «выполнено» всегда остаётся твоё; галочки шагов с тем же текстом тоже
        const doneSteps = new Set(before.checklist.filter(step => step.done).map(step => step.text));
        if (fields.checklist) {
            fields.checklist.forEach(step => step.done = step.done || doneSteps.has(step.text));
        }
        // imported — поля, какими они пришли из файла в прошлый раз
        const task = { ...before, ...fields, batch: pkg.batch ?? before.batch, deletedAt: null, imported: { ...before.imported, ...fields } };
        const changedKeys = Object.keys(fields).filter(key => !same(fields[key], before[key]));
        if (!before.deletedAt && !changedKeys.length && task.batch === before.batch) {
            rows.push({ type: "same", task, before });
            return;
        }
        // конфликт: файл меняет поле, которое ты сам поменял после импорта
        const mine = changedKeys.filter(key => !before.imported || !(key in before.imported) || !same(before.imported[key], before[key]));
        const reason = before.deletedAt ? "была в корзине — вернётся"
            : mine.length ? `ты менял здесь: ${mine.map(key => FIELD_NAMES[key] || key).join(", ")}. Возьмётся версия из файла` : "";
        rows.push({ type: before.deletedAt || mine.length ? "conflict" : "update", reason, warnings, task, before });
    });

    return { kind: "package", batch: pkg.batch, rows, newLists: ctx.newLists };
}

// бэкап заменяет всё: превью показывает только числа
export function prepareBackup(backup) {
    return { kind: "backup", backup, current: [...state.tasks.values()].filter(task => !task.deletedAt).length };
}

// ---- применение и откат ----
async function remember(label, before) {
    await setMeta("lastImport", { at: toIso(new Date()), label, before, listsBefore: state.lists.map(list => ({ ...list })) });
}

export async function applyPlan(plan) {
    const at = toIso(new Date());
    if (plan.kind === "backup") {
        // откат вернёт все прежние задачи и сотрёт пришедшие только из бэкапа
        const before = [
            ...[...state.tasks.values()].map(task => ({ id: task.id, task })),
            ...plan.backup.tasks.filter(task => !state.tasks.has(task.id)).map(task => ({ id: task.id, task: null }))
        ];
        await remember("бэкап", before);
        const keep = new Set(plan.backup.tasks.map(task => task.id));
        await Promise.all([...state.tasks.values()].filter(task => !keep.has(task.id)).map(discardTask));
        await putTasks(plan.backup.tasks.map(task => ({ ...newTask(), ...task })));
        await setLists(plan.backup.lists);
        if (plan.backup.settings) {
            Object.assign(state.settings, plan.backup.settings);
            await setMeta("settings", state.settings);
        }
        return;
    }
    const rows = plan.rows.filter(row => ["add", "update", "conflict"].includes(row.type));
    await remember(plan.batch || "импорт", rows.map(row => ({ id: row.task.id, task: row.before || null })));
    if (plan.newLists.length) {
        await setLists([...state.lists, ...plan.newLists]);
    }
    await putTasks(rows.map(row => ({ ...row.task, updatedAt: at, importedAt: at })));
}

export function lastImport() {
    return getMeta("lastImport");
}

export async function rollbackImport() {
    const last = await getMeta("lastImport");
    if (!last) {
        return null;
    }
    const restore = last.before.filter(entry => entry.task).map(entry => entry.task);
    await Promise.all(last.before.filter(entry => !entry.task && state.tasks.has(entry.id))
        .map(entry => discardTask(state.tasks.get(entry.id))));
    await putTasks(restore);
    await setLists(last.listsBefore);
    await setMeta("lastImport", null);
    return last;
}

// ---- пакеты ----
export function batches() {
    const groups = new Map();
    state.tasks.forEach(task => {
        if (task.batch && !task.deletedAt) {
            const group = groups.get(task.batch) || { batch: task.batch, count: 0, done: 0, first: null };
            group.count++;
            group.done += task.done ? 1 : 0;
            const when = task.plannedAt || task.due;
            if (when && (!group.first || when < group.first)) {
                group.first = when;
            }
            groups.set(task.batch, group);
        }
    });
    return [...groups.values()].sort((a, b) => (a.first || "").localeCompare(b.first || ""));
}

function batchTasks(batch) {
    return [...state.tasks.values()].filter(task => task.batch === batch && !task.deletedAt);
}

export function shiftBatch(batch, days) {
    const now = toIso(new Date());
    return putTasks(batchTasks(batch).map(task => ({
        ...task,
        plannedAt: shiftDays(task.plannedAt, days),
        start: shiftDays(task.start, days),
        due: shiftDays(task.due, days),
        updatedAt: now
    })));
}

export async function trashBatch(batch) {
    const tasks = batchTasks(batch);
    await Promise.all(tasks.map(trashTask));
    return () => Promise.all(tasks.map(restoreTask));
}

// ---- выгрузка для Claude: тот же формат, что и импорт ----
function toItem(task) {
    const item = { id: task.id, title: task.title };
    const listName = state.lists.find(list => list.id === task.list)?.name;
    const put = (key, value) => value !== null && value !== undefined && value !== "" && (item[key] = value);
    put("kind", task.kind !== "task" ? task.kind : null);
    put("list", listName);
    ["plannedAt", "start", "due", "durationMin", "energy", "status", "batch", "repeat", "show"].forEach(key => put(key, task[key]));
    put("priority", task.priority === "high" ? "high" : null);
    put("persistent", task.persistent || null);
    put("tags", task.tags.length ? task.tags : null);
    put("notes", task.notes);
    put("checklist", task.checklist.length
        ? task.checklist.some(step => step.done) ? task.checklist : task.checklist.map(step => step.text)
        : null);
    put("done", task.done || null);
    put("doneAt", task.doneAt);
    return item;
}

export function exportForClaude() {
    // сделанное старше 30 дней Claude не нужно
    const since = toIso(addDays(new Date(), -30));
    const items = [...state.tasks.values()]
        .filter(task => !task.deletedAt && (!task.done || (task.doneAt || "") >= since))
        .sort((a, b) => (a.plannedAt || "9").localeCompare(b.plannedAt || "9"))
        .map(toItem);
    return {
        version: FORMAT_VERSION,
        exportedAt: toIso(new Date()),
        lists: state.lists.map(list => list.name),
        items
    };
}

// ---- бэкап ----
export function makeBackup() {
    return {
        app: "plan",
        backup: 1,
        appVersion: self.APP_VERSION,
        exportedAt: toIso(new Date()),
        settings: state.settings,
        lists: state.lists,
        tasks: [...state.tasks.values()]
    };
}

// файл: на iPhone — через меню «Поделиться» (Сохранить в Файлы), иначе обычная загрузка
export async function saveFile(name, text) {
    const file = new File([text], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return true;
        } catch (e) {
            if (e.name === "AbortError") {
                return false;
            }
        }
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return true;
}
