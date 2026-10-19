// Задачи и списки в памяти плюс запись в IndexedDB. Экраны читают отсюда и вызывают save/remove.
import { getAll, getMeta, put, remove, setMeta } from "./db.js";
import { addDays, atTime, dayKey, dayOf, hasTime, parseDate, toIso } from "./dates.js";

export const state = {
    tasks: new Map(),
    lists: [],
    settings: { dayLimitMin: 7 * 60, dumpMin: 10 },
    dump: null,         // черновик выгрузки из головы: переживает закрытие приложения
    lastDumpDay: null   // день последней законченной выгрузки
};

const listeners = new Set();

export function onChange(listener) {
    listeners.add(listener);
}

function changed() {
    listeners.forEach(listener => listener());
}

export async function loadStore() {
    const [tasks, lists, settings, dump, lastDumpDay] = await Promise.all([
        getAll("tasks"), getAll("lists"), getMeta("settings"), getMeta("dump"), getMeta("lastDumpDay")
    ]);
    // корзина хранит задачи 30 дней
    const purgeBefore = toIso(addDays(new Date(), -30));
    tasks.forEach(task => {
        if (task.deletedAt && task.deletedAt < purgeBefore) {
            remove("tasks", task.id);
        } else {
            state.tasks.set(task.id, task);
        }
    });
    state.lists = lists.sort((a, b) => a.order - b.order);
    Object.assign(state.settings, settings);
    state.dump = dump || null;
    state.lastDumpDay = lastDumpDay || null;
}

export function saveSettings() {
    changed();
    return setMeta("settings", state.settings);
}

// ---- выгрузка из головы ----
export function saveDump(dump) {
    state.dump = dump;
    changed();
    return setMeta("dump", dump);
}

export function finishDump() {
    state.dump = null;
    state.lastDumpDay = dayKey(new Date());
    changed();
    return Promise.all([setMeta("dump", null), setMeta("lastDumpDay", state.lastDumpDay)]);
}

// ---- задачи ----
export function newTask(fields = {}) {
    const now = toIso(new Date());
    return {
        id: "t-" + crypto.randomUUID().slice(0, 8),
        kind: "task",
        title: "",
        list: null,
        plannedAt: null,   // слот в плане: "2026-11-03" (день) или "2026-11-03T19:00:00+03:00" (время)
        durationMin: null,
        start: null,       // не раньше этого дня
        due: null,         // жёсткий дедлайн
        energy: null,      // "high" | "mid" | "low"
        priority: "normal",
        persistent: false,
        tags: [],
        notes: "",
        checklist: [],     // [{ text, done }]
        status: null,
        batch: null,       // пакет импорта от Claude
        repeat: null,      // { unit: "day"|"week"|"month", every, weekdays, monthDay } — см. docs/claude-format.md
        show: null,        // выступление: { client, phone, address, fee, format, travelMin }
        importedAt: null,  // когда задача последний раз пришла из файла
        imported: null,    // поля, какими они пришли из файла: по ним видно, что ты менял сам
        done: false,
        doneAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...fields
    };
}

export async function saveTask(task) {
    task.updatedAt = toIso(new Date());
    state.tasks.set(task.id, task);
    changed();
    await put("tasks", task);
}

export function setDone(task, done) {
    task.done = done;
    task.doneAt = done ? toIso(new Date()) : null;
    return saveTask(task);
}

// импорт, откат, сдвиг пакета: много задач сразу, даты правки ставит вызывающий
export async function putTasks(tasks) {
    tasks.forEach(task => state.tasks.set(task.id, task));
    changed();
    await Promise.all(tasks.map(task => put("tasks", task)));
}

// списки целиком: импорт добавляет новые, откат возвращает прежние
export async function setLists(lists) {
    const keep = new Set(lists.map(list => list.id));
    const gone = state.lists.filter(list => !keep.has(list.id));
    state.lists = [...lists].sort((a, b) => a.order - b.order);
    changed();
    await Promise.all([...gone.map(list => remove("lists", list.id)), ...lists.map(list => put("lists", list))]);
}

// удаление — в корзину на 30 дней
export function trashTask(task) {
    task.deletedAt = toIso(new Date());
    return saveTask(task);
}

// стереть совсем, без корзины: только для «Отменить» сразу после создания
export function discardTask(task) {
    state.tasks.delete(task.id);
    changed();
    return remove("tasks", task.id);
}

export function restoreTask(task) {
    task.deletedAt = null;
    return saveTask(task);
}

// ---- запросы ----
const alive = () => [...state.tasks.values()].filter(task => !task.deletedAt);

export function endOf(task) {
    if (!hasTime(task.plannedAt)) {
        return null;
    }
    return new Date(parseDate(task.plannedAt).getTime() + (task.durationMin || 0) * 60000);
}

export function isOverdue(task, now = new Date()) {
    if (task.done || task.deletedAt) {
        return false;
    }
    if (task.due && (hasTime(task.due) ? parseDate(task.due) < now : dayOf(task.due) < dayKey(now))) {
        return true;
    }
    return !!task.plannedAt && dayOf(task.plannedAt) < dayKey(now);
}

export function overdueTasks(now = new Date()) {
    return alive().filter(task => isOverdue(task, now))
        .sort((a, b) => (a.plannedAt || a.due || "").localeCompare(b.plannedAt || b.due || ""));
}

export function dayTasks(key) {
    const tasks = alive().filter(task => dayOf(task.plannedAt) === key);
    const timed = tasks.filter(task => hasTime(task.plannedAt))
        .sort((a, b) => parseDate(a.plannedAt) - parseDate(b.plannedAt));
    const anytime = tasks.filter(task => !hasTime(task.plannedAt))
        .sort((a, b) => a.done - b.done || a.createdAt.localeCompare(b.createdAt));
    return { timed, anytime };
}

export function inboxTasks() {
    return alive().filter(task => !task.plannedAt && !task.done)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// задача «сейчас»: идёт по времени; если ничего не идёт — ближайшая следующая
export function currentTask(now = new Date()) {
    const { timed } = dayTasks(dayKey(now));
    const open = timed.filter(task => !task.done);
    const running = open.find(task => parseDate(task.plannedAt) <= now && endOf(task) > now);
    if (running) {
        return { task: running, running: true };
    }
    const next = open.find(task => parseDate(task.plannedAt) > now);
    return next ? { task: next, running: false } : null;
}

export function listName(id) {
    return state.lists.find(list => list.id === id)?.name || "";
}

// ---- перенос в одно касание ----
export const POSTPONE = [
    { id: "15m", label: "+15 мин" },
    { id: "1h", label: "+1 час" },
    { id: "evening", label: "Вечером" },
    { id: "tomorrow", label: "Завтра утром" },
    { id: "weekend", label: "В выходные" }
];

export function postponed(task, option, now = new Date()) {
    const base = hasTime(task.plannedAt) && parseDate(task.plannedAt) > now ? parseDate(task.plannedAt) : now;
    switch (option) {
        case "15m": return toIso(new Date(base.getTime() + 15 * 60000));
        case "1h": return toIso(new Date(base.getTime() + 60 * 60000));
        case "evening": return toIso(atTime(now.getHours() >= 19 ? addDays(now, 1) : now, 19));
        case "tomorrow": return toIso(atTime(addDays(now, 1), 9));
        case "weekend": {
            const saturday = addDays(now, (6 - now.getDay() + 7) % 7 || 7);
            return toIso(atTime(saturday, 10));
        }
    }
}
