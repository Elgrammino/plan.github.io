// Задачи и списки в памяти плюс запись в IndexedDB. Экраны читают отсюда и вызывают save/remove.
import { getAll, getMeta, put, remove, setMeta } from "./db.js";
import { addDays, atTime, dayKey, dayOf, hasTime, parseDate, shiftDays, toIso } from "./dates.js";
import { daysBetween, nextAfterDone } from "./repeat.js";

export const state = {
    tasks: new Map(),
    lists: [],
    settings: defaultSettings(),
    templates: [],      // шаблоны чек-листов: [{ id, name, steps: ["…"] }]
    chains: [],         // шаблоны цепочек: [{ id, name, lines: ["-2д 12:00 Снять: {title} 1ч"] }] — см. js/chains.js
    goals: [],          // цели недели: [{ id, title, week: "2026-10-19" (понедельник), done }]
    rituals: {},        // { morning: "2026-10-19", evening: "2026-10-19" } — когда ритуал пройден
    dump: null,         // черновик выгрузки из головы: переживает закрытие приложения
    lastDumpDay: null   // день последней законченной выгрузки
};

function defaultSettings() {
    return {
        dayLimitMin: 7 * 60,
        dumpMin: 10,
        morning: "08:00",          // утренний ритуал
        evening: "20:00",          // вечерний ритуал: с этого времени зовём на выгрузку
        postpone: ["15m", "1h", "evening", "tomorrow", "weekend"],
        postponeEvening: "19:00",  // «Вечером»
        postponeMorning: "09:00",  // «Завтра утром», «Послезавтра»
        postponeWeekend: "10:00"   // «В выходные»
    };
}

// примеры, чтобы было с чего начать: правятся в «Ещё → Шаблоны»
const DEFAULT_TEMPLATES = [
    { id: "tpl-corp", name: "Сборы: корпоратив", steps: ["Реквизит по списку номера", "Костюм отглажен", "Колонка и микрофон заряжены", "Запасные батарейки", "Адрес и контакт заказчика", "Договор и предоплата"] },
    { id: "tpl-kids", name: "Сборы: детский праздник", steps: ["Реквизит для детского номера", "Костюм", "Колонка заряжена", "Призы и подарки", "Адрес и имя именинника", "Контакт родителей"] }
];

// {title} — название главной задачи; «дорога» — время в пути из карточки выступления
const DEFAULT_CHAINS = [
    { id: "chain-post", name: "Публикация", lines: ["-2д 12:00 Снять: {title} 1ч", "-1д 15:00 Смонтировать: {title} 2ч", "-3ч Подпись: {title} 15м"] },
    { id: "chain-show", name: "Выступление", lines: ["-3ч Сборы: {title} 30м", "-дорога Выезд: {title} дорога", "+2ч После: {title} 30м"] }
];

const listeners = new Set();

// возвращает функцию отписки
export function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function changed() {
    listeners.forEach(listener => listener());
}

export async function loadStore() {
    const [tasks, lists, settings, dump, lastDumpDay, templates, chains, goals, rituals] = await Promise.all([
        getAll("tasks"), getAll("lists"), getMeta("settings"), getMeta("dump"), getMeta("lastDumpDay"), getMeta("templates"),
        getMeta("chains"), getMeta("goals"), getMeta("rituals")
    ]);
    state.templates = templates || DEFAULT_TEMPLATES;
    state.chains = chains || DEFAULT_CHAINS;
    state.goals = goals || [];
    state.rituals = rituals || {};
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
    Object.assign(state.settings, settings); // поверх значений по умолчанию: новые ключи не теряются
    state.dump = dump || null;
    state.lastDumpDay = lastDumpDay || null;
}

export function saveChains() {
    changed();
    return setMeta("chains", state.chains);
}

export function saveGoals() {
    changed();
    return setMeta("goals", state.goals);
}

export function markRitual(name) {
    state.rituals[name] = dayKey(new Date());
    changed();
    return setMeta("rituals", state.rituals);
}

export function saveTemplates() {
    changed();
    return setMeta("templates", state.templates);
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
        post: null,        // публикация: { format: "reels"|"post"|"stories", rubric, hook, caption, hashtags }
        nextId: null,      // у выполненной повторяющейся: id следующего раза
        goal: null,        // id цели недели
        chainOf: null,     // задача цепочки: id главной задачи
        anchorAt: null,    // plannedAt главной задачи, от которого посчитана цепочка
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
    const moved = followChain(task);
    changed();
    await Promise.all([put("tasks", task), ...moved.map(child => put("tasks", child))]);
}

// главную задачу перенесли — несделанные задачи её цепочки едут следом на тот же сдвиг
function followChain(anchor) {
    if (!hasTime(anchor.plannedAt)) {
        return [];
    }
    const now = toIso(new Date());
    return [...state.tasks.values()].filter(child => child.chainOf === anchor.id && !child.done && !child.deletedAt
        && hasTime(child.anchorAt) && child.anchorAt !== anchor.plannedAt)
        .map(child => {
            const shift = parseDate(anchor.plannedAt) - parseDate(child.anchorAt);
            if (hasTime(child.plannedAt)) {
                child.plannedAt = toIso(new Date(parseDate(child.plannedAt).getTime() + shift));
            }
            child.anchorAt = anchor.plannedAt;
            child.updatedAt = now;
            return child;
        });
}

// у повторяющейся задачи выполнение создаёт следующий раз, а «Вернуть» его убирает
export function setDone(task, done) {
    task.done = done;
    task.doneAt = done ? toIso(new Date()) : null;
    // у публикации «сделано» и стадия «вышло» — одно и то же
    if (task.kind === "post") {
        task.status = done ? "вышло" : task.status === "вышло" ? "смонтировано" : task.status;
    }
    if (done && task.repeat && !task.nextId) {
        const next = nextInstance(task);
        task.nextId = next.id;
        saveTask(next);
    } else if (!done && task.nextId) {
        const next = state.tasks.get(task.nextId);
        if (next && !next.done) {
            discardTask(next);
        }
        task.nextId = null;
    }
    return saveTask(task);
}

function nextInstance(task, now = new Date()) {
    const planned = task.plannedAt ? parseDate(task.plannedAt) : null;
    const day = nextAfterDone(task.repeat, planned, now);
    const shift = daysBetween(planned || now, day);
    const { id, createdAt, updatedAt, done, doneAt, nextId, importedAt, imported, deletedAt, chainOf, anchorAt, goal, ...fields } = task;
    return newTask({
        ...fields,
        plannedAt: !planned ? dayKey(day) : shiftDays(task.plannedAt, shift),
        due: shiftDays(task.due, shift),
        start: shiftDays(task.start, shift),
        tags: [...task.tags],
        repeat: { ...task.repeat },
        show: task.show && { ...task.show },
        post: task.post && { ...task.post },
        status: task.kind === "post" ? "идея" : task.status,
        checklist: task.checklist.map(step => ({ text: step.text, done: false }))
    });
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

// задача с «не раньше» в будущем во Входящих не мозолит глаза: она в «Начать позже»
export function inboxTasks(now = new Date()) {
    return alive().filter(task => !task.plannedAt && !task.done && !(task.start && task.start > dayKey(now)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function laterTasks(now = new Date()) {
    return alive().filter(task => !task.plannedAt && !task.done && task.start && task.start > dayKey(now))
        .sort((a, b) => a.start.localeCompare(b.start));
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

// ---- корзина и журнал сделанного ----
export function trashedTasks() {
    return [...state.tasks.values()].filter(task => task.deletedAt)
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// сделанное по дням, свежие дни сверху: [{ day: "2026-10-19", tasks }]
export function doneByDay(days = 60, now = new Date()) {
    const since = dayKey(addDays(now, -days));
    const groups = new Map();
    alive().filter(task => task.done && task.doneAt && dayOf(task.doneAt) >= since)
        .sort((a, b) => b.doneAt.localeCompare(a.doneAt))
        .forEach(task => {
            const day = dayOf(task.doneAt);
            groups.has(day) ? groups.get(day).push(task) : groups.set(day, [task]);
        });
    return [...groups].map(([day, tasks]) => ({ day, tasks }));
}

// стереть совсем: корзина «Очистить»
export async function purgeTasks(tasks) {
    tasks.forEach(task => state.tasks.delete(task.id));
    changed();
    await Promise.all(tasks.map(task => remove("tasks", task.id)));
}

// ---- перенос в одно касание: какие варианты показывать, решают настройки ----
export const POSTPONE = [
    { id: "15m", label: "+15 мин" },
    { id: "1h", label: "+1 час" },
    { id: "3h", label: "+3 часа" },
    { id: "evening", label: "Вечером" },
    { id: "tomorrow", label: "Завтра утром" },
    { id: "dayafter", label: "Послезавтра" },
    { id: "weekend", label: "В выходные" },
    { id: "week", label: "Через неделю" }
];

export function postponeOptions() {
    return POSTPONE.filter(option => state.settings.postpone.includes(option.id));
}

const at = (date, time) => atTime(date, ...time.split(":").map(Number));

export function postponed(task, option, now = new Date()) {
    const base = hasTime(task.plannedAt) && parseDate(task.plannedAt) > now ? parseDate(task.plannedAt) : now;
    const { postponeEvening, postponeMorning, postponeWeekend } = state.settings;
    switch (option) {
        case "15m": return toIso(new Date(base.getTime() + 15 * 60000));
        case "1h": return toIso(new Date(base.getTime() + 60 * 60000));
        case "3h": return toIso(new Date(base.getTime() + 3 * 60 * 60000));
        case "evening": {
            const tonight = at(now, postponeEvening);
            return toIso(tonight > now ? tonight : addDays(tonight, 1));
        }
        case "tomorrow": return toIso(at(addDays(now, 1), postponeMorning));
        case "dayafter": return toIso(at(addDays(now, 2), postponeMorning));
        case "weekend": {
            const saturday = addDays(now, (6 - now.getDay() + 7) % 7 || 7);
            return toIso(at(saturday, postponeWeekend));
        }
        case "week": return toIso(at(addDays(now, 7), hasTime(task.plannedAt) ? timeOf(task.plannedAt) : postponeMorning));
    }
}

function timeOf(value) {
    const date = parseDate(value);
    return `${date.getHours()}:${date.getMinutes()}`;
}
