// Напоминания iOS через Быстрые команды. Сервера нет, поэтому:
// «Отправить»: приложение кладёт в буфер JSON со всеми напоминаниями на 14 дней и запускает команду
//   «План: отправить» — она удаляет старые открытые напоминания плана и создаёт присланные.
// «Сверить»: команда «План: сверить» кладёт в буфер строки «метка|выполнено|срок», приложение их вставляет.
// Метка в заметке напоминания: plan:<id>:<n> или plan:<id>@<день>:<n> для будущих повторов, n — 1..3 (настойчиво).
import { getMeta, setMeta } from "./db.js";
import { addDays, atTime, dayKey, dayOf, hasTime, parseDate, toIso } from "./dates.js";
import { nextDate } from "./repeat.js";
import { saveTask, setDone, state } from "./store.js";

export const SHORTCUT_SEND = "План: отправить";
export const SHORTCUT_SYNC = "План: сверить";
export const SHORTCUT_SIRI = "Добавь в план";
export const SHORTCUT_TIMER = "План: таймер"; // запускает таймер «Часов» на присланное число минут

const WINDOW_DAYS = 14;
const NAG_MINUTES = [0, 10, 20]; // настойчиво: три напоминания с одной меткой задачи
const KEY = /plan:([A-Za-z0-9_-]+)(?:@(\d{4}-\d{2}-\d{2}))?:(\d)/;

function alertsFor(task, now, until) {
    const alerts = [];
    if (hasTime(task.plannedAt)) {
        let at = parseDate(task.plannedAt);
        let day = null; // null — сама задача; день — будущий повтор, которого ещё нет в плане
        while (at <= until) {
            if (at > now) {
                alerts.push({ at, day, title: task.title });
            }
            if (!task.repeat) {
                break;
            }
            const next = nextDate(task.repeat, at);
            at = atTime(next, at.getHours(), at.getMinutes());
            day = dayKey(next);
        }
    } else if (hasTime(task.due) && parseDate(task.due) > now && parseDate(task.due) <= until) {
        alerts.push({ at: parseDate(task.due), day: null, title: "Дедлайн: " + task.title });
    }
    return alerts;
}

// все напоминания, которые должны стоять в iOS прямо сейчас
export function reminderItems(now = new Date()) {
    const until = addDays(now, WINDOW_DAYS);
    const items = [];
    state.tasks.forEach(task => {
        if (task.done || task.deletedAt) {
            return;
        }
        alertsFor(task, now, until).forEach(({ at, day, title }) => {
            // в день дедлайна напоминание становится настойчивым
            const nag = task.persistent || (task.due && dayOf(task.due) === dayKey(at));
            (nag ? NAG_MINUTES : [0]).forEach((minutes, i) => {
                const key = `plan:${task.id}${day ? "@" + day : ""}:${i + 1}`;
                const steps = task.checklist.filter(step => !step.done).map(step => "• " + step.text).join("\n");
                // общий список уходит своим названием, остальное — в список «План»
                const list = state.lists.find(item => item.id === task.list && item.shared)?.name || "";
                items.push({
                    key,
                    list,
                    title: i ? `${title} (ещё раз)` : title,
                    due: toIso(new Date(at.getTime() + minutes * 60000)),
                    notes: [task.notes, steps, key].filter(Boolean).join("\n\n")
                });
            });
        });
    });
    // ритуалы (утро, вечер, бэкап) сюда не идут: это повторяющиеся напоминания в списке «Ритуалы»,
    // их создают один раз руками (мастер команд, раздел 4), чтобы не забивать список «План»
    return items.sort((a, b) => a.due.localeCompare(b.due));
}

// ---- что изменилось с последней отправки ----
const fingerprint = item => `${item.due}|${item.title}|${item.notes}`;

// последняя отправка в памяти: «Сегодня» считает изменения без ожидания базы
let sentState = { at: null, items: {} };

export async function loadReminders() {
    sentState = (await getMeta("remindersSent")) || sentState;
}

export function lastSentAt() {
    return sentState.at;
}

export function pendingChanges(now = new Date()) {
    const sent = sentState.items;
    const items = reminderItems(now);
    const current = new Map(items.map(item => [item.key, fingerprint(item)]));
    let changes = 0;
    current.forEach((print, key) => sent[key] !== print && changes++);
    // уже прошедшие напоминания отправлять заново не нужно — их не считаем
    Object.entries(sent).forEach(([key, print]) => !current.has(key) && new Date(print.split("|")[0]) > now && changes++);
    return { changes, items };
}

// вызывать прямо из нажатия: iOS пускает в буфер и в Быстрые команды только по жесту
// в команду время уходит как на часах телефона, «21.10.2026 19:00», без часового пояса:
// «Получить даты из входных данных» читает строку ISO с поправкой по-своему и сдвигает время
const pad = n => String(n).padStart(2, "0");
export function wireTime(iso) {
    const at = parseDate(iso);
    return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export async function sendToReminders(items) {
    const wire = items.map(item => ({ ...item, due: wireTime(item.due) }));
    await navigator.clipboard.writeText(JSON.stringify({ app: "plan", reminders: wire }));
    runShortcut(SHORTCUT_SEND);
    sentState = { at: toIso(new Date()), items: Object.fromEntries(items.map(item => [item.key, fingerprint(item)])) };
    await setMeta("remindersSent", sentState);
}

let launchedAt = 0;

export function runShortcut(name, text) {
    launchedAt = Date.now();
    location.href = "shortcuts://run-shortcut?name=" + encodeURIComponent(name) + (text ? "&input=text&text=" + encodeURIComponent(text) : "");
}

// сразу после запуска команды не предлагаем «Вставить»: в буфере наш же JSON
export function shortcutJustRan() {
    return Date.now() - launchedAt < 10 * 60000;
}

// ---- сверка ----
export function looksLikeSync(text) {
    return KEY.test(text) && /\|/.test(text);
}

const YES = /^(да|yes|true|1|выполнено|завершено)$/i;

// строки «plan:t-ab12:1|Да|2026-10-19T19:00:00+03:00» → изменения в плане
export function readSync(text, now = new Date()) {
    const found = new Map();
    text.split(/\r?\n/).forEach(line => {
        const [mark = "", done = "", due = ""] = line.split("|").map(part => part.trim());
        const match = mark.match(KEY);
        if (!match) {
            return;
        }
        const [, id, day, n] = match;
        const entry = found.get(id + (day || "")) || { id, day, done: false, due: null };
        entry.done = entry.done || YES.test(done);
        if (n === "1" && due && !isNaN(new Date(due))) {
            entry.due = new Date(due);
        }
        found.set(id + (day || ""), entry);
    });

    const done = [];
    const moved = [];
    found.forEach(entry => {
        const task = state.tasks.get(entry.id);
        if (!task || task.deletedAt || task.done) {
            return;
        }
        // будущий повтор, отмеченный заранее: отмечаем, только если это и есть текущий раз
        if (entry.day && dayOf(task.plannedAt) !== entry.day) {
            return;
        }
        if (entry.done) {
            done.push(task);
        } else if (!entry.day && entry.due && hasTime(task.plannedAt)
            && Math.abs(entry.due - parseDate(task.plannedAt)) >= 60000 && entry.due > now) {
            // время поменяли в Напоминаниях
            moved.push({ task, plannedAt: toIso(entry.due) });
        }
    });
    return { done, moved, seen: found.size };
}

export async function applySync({ done, moved }) {
    const before = moved.map(({ task }) => ({ task, plannedAt: task.plannedAt }));
    for (const task of done) {
        await setDone(task, true);
    }
    for (const { task, plannedAt } of moved) {
        task.plannedAt = plannedAt;
        await saveTask(task);
    }
    await setMeta("lastSyncAt", toIso(new Date()));
    // откат: снять отметки и вернуть время
    return async () => {
        for (const task of done) {
            await setDone(task, false);
        }
        for (const { task, plannedAt } of before) {
            task.plannedAt = plannedAt;
            await saveTask(task);
        }
    };
}
