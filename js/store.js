// Задачи и списки в памяти плюс запись в IndexedDB. Экраны читают отсюда и вызывают save/remove.
import { getAll, getMeta, put, remove } from "./db.js";
import { addDays, atTime, dayKey, dayOf, hasTime, parseDate, toIso } from "./dates.js";

export const state = {
    tasks: new Map(),
    lists: [],
    settings: { dayLimitMin: 7 * 60 }
};

const listeners = new Set();

export function onChange(listener) {
    listeners.add(listener);
}

function changed() {
    listeners.forEach(listener => listener());
}

export async function loadStore() {
    const [tasks, lists, settings] = await Promise.all([getAll("tasks"), getAll("lists"), getMeta("settings")]);
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
        batch: null,
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

// удаление — в корзину на 30 дней
export function trashTask(task) {
    task.deletedAt = toIso(new Date());
    return saveTask(task);
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
