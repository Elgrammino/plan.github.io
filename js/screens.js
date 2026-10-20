// Экраны «Сегодня» и «Входящие».
import { dayKey, durationText, parseDate, relativeDay, timeText, toIso } from "./dates.js";
import { currentTask, dayTasks, endOf, inboxTasks, isOverdue, laterTasks, listName, overdueTasks, state } from "./store.js";
import { todayButton } from "./notify.js";
import { departure, showDayBlock } from "./show.js";
import { focusChip } from "./focus.js";
import { tutorialChip } from "./tutorial.js";
import { habitsStrip } from "./habits.js";
import { morningEntry, eveningEntry, goalsChip } from "./rituals.js";
import { repeatText } from "./repeat.js";
import { esc, escTitle, ICONS } from "./ui.js";

const ENERGY_DOTS = { low: "●", mid: "●●", high: "●●●" };

function sub(task, { showDay = false } = {}) {
    const parts = [];
    const leave = task.kind === "show" && departure(task);
    if (leave) {
        parts.push("выезд " + timeText(toIso(leave)));
    }
    if (showDay && task.plannedAt) {
        parts.push(esc(relativeDay(task.plannedAt)));
    }
    if (task.list) {
        parts.push(esc(listName(task.list)));
    }
    if (task.durationMin) {
        parts.push(durationText(task.durationMin));
    }
    if (task.repeat) {
        parts.push("↻ " + esc(repeatText(task.repeat)));
    }
    if (task.checklist.length) {
        parts.push(`${task.checklist.filter(step => step.done).length} из ${task.checklist.length}`);
    }
    if (task.due) {
        parts.push("до " + esc(relativeDay(task.due)));
    }
    if (task.priority === "high") {
        parts.push("важно");
    }
    if (task.energy) {
        parts.push(`<span class="energy">${ENERGY_DOTS[task.energy]}</span>`);
    }
    return parts.join(" · ");
}

export function row(task, { time = null, side = "", showDay = false } = {}) {
    const classes = ["item", task.done && "done", isOverdue(task) && "late"].filter(Boolean).join(" ");
    const details = sub(task, { showDay });
    return `
        <div class="${classes}" data-id="${task.id}">
            ${time !== null ? `<span class="time mono">${time}</span>` : ""}
            <button class="check" data-action="toggle" aria-label="${task.done ? "Вернуть" : "Готово"}"></button>
            <button class="body" data-action="edit">
                <div class="name">${escTitle(task.title)}</div>
                ${details ? `<div class="sub">${details}</div>` : ""}
            </button>
            ${side}
        </div>`;
}

// 79 → "1:19"
function clock(minutes) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function weekdayLine(date, isToday) {
    const weekday = date.toLocaleDateString("ru-RU", { weekday: "long" });
    const rel = relativeDay(dayKey(date));
    const prefix = isToday || ["завтра", "вчера"].includes(rel) ? rel.charAt(0).toUpperCase() + rel.slice(1) + ", " : "";
    return prefix + (prefix ? weekday : weekday.charAt(0).toUpperCase() + weekday.slice(1));
}

// вход в выгрузку: продолжить черновик или тихая кнопка (вечером зовёт «Закрыть день», там тоже есть выгрузка)
function dumpEntry() {
    const dump = state.dump;
    if (dump) {
        const n = dump.phase === "write" ? dump.thoughts.length : dump.cards.length;
        const what = dump.phase === "write" ? "Продолжить выгрузку" : "Разобрать выгрузку";
        return `<button class="chip-btn today-tool" data-dump>${what}${n ? ` · <span class="mono">${n}</span>` : ""}</button>`;
    }
    return `<button class="chip-btn today-tool" data-dump>Выгрузка из&nbsp;головы</button>`;
}

function minutesBetween(a, b) {
    return Math.round((b - a) / 60000);
}

// ---- «Сегодня» ----
export function renderToday(el, viewDay) {
    const now = new Date();
    const key = dayKey(viewDay);
    const isToday = key === dayKey(now);
    const { timed, anytime } = dayTasks(key);
    const all = [...timed, ...anytime];

    const planned = all.reduce((sum, task) => sum + (task.durationMin || 0), 0);
    const limit = state.settings.dayLimitMin;
    const over = planned > limit;

    let html = `
        <div class="day-head">
            <h1 class="title">${esc(viewDay.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }))}</h1>
            <button class="icon-btn" data-search aria-label="Поиск">${ICONS.search}</button>
            <button class="icon-btn" data-day="-1" aria-label="Предыдущий день">${ICONS.prev}</button>
            <button class="icon-btn" data-day="1" aria-label="Следующий день">${ICONS.next}</button>
        </div>
        <div class="load">
            <span>${esc(weekdayLine(viewDay, isToday))}${over ? " · больше лимита на " + durationText(planned - limit) : ""}</span>
            <span class="mono">${durationText(planned) || "0 ч"} из ${durationText(limit)}</span>
        </div>
        <div class="bar ${over ? "over" : ""}"><i style="width: ${Math.min(100, planned / limit * 100)}%"></i></div>
        ${isToday ? "" : `<button class="chip-btn back-today" data-day="0">К сегодня</button>`}
        <div id="installHint"></div>`;

    if (isToday) {
        html += `<div class="today-tools">${tutorialChip()}${focusChip()}${todayButton()}${dumpEntry()}${goalsChip()}</div>`
            + habitsStrip(now) + morningEntry(now) + eveningEntry(now) + showDayBlock(now);
        const current = currentTask(now);
        if (current) {
            const { task, running } = current;
            const minutes = running ? minutesBetween(now, endOf(task)) : minutesBetween(now, parseDate(task.plannedAt));
            html += `
                <div class="now" data-id="${task.id}">
                    <div class="label" style="margin: 0">${running ? "Сейчас" : "Дальше, в " + timeText(task.plannedAt)}</div>
                    <div class="now-title">${esc(task.title)}</div>
                    <div class="meta">${sub(task)}</div>
                    <div class="timer"><span class="mono">${clock(Math.max(1, minutes))}</span><small>${running ? "осталось" : "до начала"}</small></div>
                    <div class="btns">
                        <button class="btn primary" data-action="toggle">Готово</button>
                        <button class="btn ghost" data-action="postpone">Перенести</button>
                        <button class="btn ghost icon-only" data-action="focus" aria-label="Фокус">${ICONS.timer}</button>
                    </div>
                </div>`;
        }

        const late = overdueTasks(now).filter(task => !(task.plannedAt && task.plannedAt.startsWith(key)));
        if (late.length) {
            html += `<div class="label">Просрочено</div>` +
                late.map(task => row(task, { time: "", showDay: true })).join("");
        }
    }

    if (!all.length) {
        html += `
            <div class="empty">
                <svg class="mark" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22"/><path d="M32 18v14l9 6"/></svg>
                <p>${isToday ? "На сегодня ничего. Добавь задачу кнопкой +." : "На этот день ничего не запланировано."}</p>
            </div>`;
    }

    if (timed.length) {
        html += `<div class="label">День</div>`;
        let prevEnd = null;
        let nowShown = !isToday;
        for (const task of timed) {
            const start = parseDate(task.plannedAt);
            if (!nowShown && start > now) {
                html += `<div class="nowline"><span class="mono">${timeText(toIso(now))}</span></div>`;
                nowShown = true;
            }
            const gapFrom = prevEnd && (isToday && prevEnd < now ? now : prevEnd);
            if (gapFrom && minutesBetween(gapFrom, start) >= 15) {
                html += `<div class="gap mono">свободно ${durationText(minutesBetween(gapFrom, start))}</div>`;
            }
            html += row(task, { time: timeText(task.plannedAt) });
            const end = endOf(task);
            prevEnd = prevEnd && prevEnd > end ? prevEnd : end;
        }
        if (!nowShown) {
            html += `<div class="nowline"><span class="mono">${timeText(toIso(now))}</span></div>`;
        }
    }

    if (anytime.length) {
        html += `<div class="label">В течение дня</div>` + anytime.map(task => row(task, { time: "" })).join("");
    }

    // тихая ссылка на журнал: сколько уже успел
    if (isToday) {
        const doneToday = [...state.tasks.values()].filter(task => task.done && !task.deletedAt && task.doneAt?.startsWith(key)).length;
        if (doneToday) {
            html += `<button class="chip-btn journal-link" data-journal>Сделано сегодня · <span class="mono">${doneToday}</span></button>`;
        }
    }

    el.innerHTML = html;
}

// ---- «Входящие» ----
export function renderInbox(el) {
    const tasks = inboxTasks();
    const later = laterTasks();
    el.innerHTML = `
        <div class="day-head">
            <h1 class="title">Входящие</h1>
            <button class="icon-btn" data-search aria-label="Поиск">${ICONS.search}</button>
        </div>
        <p class="subtitle">Задачи без дня. Разложи их по дням.</p>
        ${tasks.length ? tasks.map(task => row(task, {
            side: `<button class="chip-btn side" data-action="today">Сегодня</button>`
        })).join("") : `
            <div class="empty">
                <svg class="mark" viewBox="0 0 64 64"><path d="M10 36l8-20h28l8 20v14H10z"/><path d="M10 36h13l3 5h12l3-5h13"/></svg>
                <p>Пусто. Всё разложено по дням.</p>
            </div>`}
        ${later.length ? `<div class="label">Начать позже</div>` + later.map(task => row(task, {
            side: `<span class="chip-btn side later mono">с ${esc(relativeDay(task.start))}</span>`
        })).join("") : ""}`;
}

