// Экраны «Сегодня» и «Входящие».
import { dayKey, dayOf, durationText, hasTime, parseDate, relativeDay, timeText, toIso } from "./dates.js";
import { currentTask, dayTasks, endOf, inboxTasks, isOverdue, laterTasks, listName, overdueTasks, state } from "./store.js";
import { todayButton } from "./notify.js";
import { actions as showActions, departure, showDayStrip } from "./show.js";
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
    // «вчера · до вчера» — дедлайн в тот же день, что и план, не повторяем
    if (task.due && !(showDay && dayOf(task.due) === dayOf(task.plannedAt))) {
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

// missed — время сегодня уже прошло, а не сделано: иначе такая строка выглядит как будущая
export function row(task, { time = null, side = "", showDay = false, missed = false } = {}) {
    const classes = ["item", task.done && "done", (isOverdue(task) || missed) && "late", missed && "missed"].filter(Boolean).join(" ");
    const details = [missed ? "прошло, не сделано" : "", sub(task, { showDay })].filter(Boolean).join(" · ");
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

// «Дальше / Сейчас»: одно дело крупно, шаги, отсчёт и «Приступить» — 40 минут фокуса, потом перерыв
// что показать крупно: незакрытая подготовка к сегодняшнему выступлению (сборы с шагами, шаг цепочки),
// даже если её время уже прошло; иначе — как раньше, текущее или следующее дело
function cardTask(now) {
    const show = todayShow(now);
    if (show) {
        const start = parseDate(show.plannedAt);
        const prep = dayTasks(dayKey(now)).timed
            .filter(task => !task.done && task.id !== show.id && parseDate(task.plannedAt) < start
                && (task.chainOf === show.id || task.checklist.some(step => !step.done)))
            .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))[0];
        if (prep) {
            return { task: prep, running: parseDate(prep.plannedAt) <= now, prepFor: show };
        }
    }
    return currentTask(now);
}

// сегодняшнее несделанное выступление со временем
function todayShow(now) {
    return dayTasks(dayKey(now)).timed.find(task => task.kind === "show" && !task.done) || null;
}

function focusCard({ task, running, prepFor }, now) {
    const show = task.kind === "show" ? task : prepFor;
    const leave = show && departure(show);
    // в день выступления отсчёт — до выезда: это настоящий дедлайн
    const toLeave = leave && leave > now ? minutesBetween(now, leave) : null;
    const minutes = toLeave ?? (running ? minutesBetween(now, endOf(task)) : minutesBetween(now, parseDate(task.plannedAt)));
    const countLabel = toLeave !== null ? "до выезда" : running ? "осталось" : "до начала";
    const steps = task.checklist.filter(step => !step.done).slice(0, 6);
    const working = state.focus && state.focus.taskId === task.id;
    const label = task.kind === "show"
        ? `Выступление, в ${timeText(task.plannedAt)}${leave ? ", выезд в " + timeText(toIso(leave)) : ""}`
        : prepFor && parseDate(task.plannedAt) < now
            ? `Не сделано, было в ${timeText(task.plannedAt)} · выезд в ${timeText(toIso(leave))}`
            : running ? "Сейчас" : "Дальше, в " + timeText(task.plannedAt);
    // на само выступление фокус не запускаем: вместо «Приступить» — позвонить и маршрут
    if (task.kind === "show") {
        return `
        <section class="focus-card show" data-id="${task.id}">
            <div class="label" style="margin: 0">${label}</div>
            <button class="focus-card-title" data-action="edit">${escTitle(task.title)}</button>
            <div class="meta">${esc([task.show?.client, task.show?.address].filter(Boolean).join(" · "))}</div>
            ${steps.length ? `<div class="focus-card-steps">${steps.map(step => `<span>${esc(step.text)}</span>`).join("")}</div>` : ""}
            <div class="focus-card-count"><span class="mono">${clock(Math.max(1, minutes))}</span><small>${countLabel}</small></div>
            <div class="btns show-actions">${showActions(task.show)}</div>
            <div class="btns">
                <button class="btn ghost" data-action="toggle">Отыграл</button>
                <button class="btn ghost" data-action="postpone">Перенести</button>
            </div>
        </section>`;
    }
    return `
        <section class="focus-card" data-id="${task.id}">
            <div class="label" style="margin: 0">${label}</div>
            <button class="focus-card-title" data-action="edit">${escTitle(task.title)}</button>
            <div class="meta">${sub(task)}</div>
            ${steps.length ? `<div class="focus-card-steps">${steps.map(step => `<span>${esc(step.text)}</span>`).join("")}</div>` : ""}
            <div class="focus-card-count"><span class="mono">${clock(Math.max(1, minutes))}</span><small>${countLabel}</small></div>
            ${working
                ? `<button class="btn primary wide" data-focus-open>Открыть таймер</button>`
                : `<button class="btn primary wide" data-action="start">Приступить · ${Number(state.settings.focusMin) || 40}&nbsp;мин</button>`}
            <div class="btns">
                <button class="btn ghost" data-action="toggle">Готово</button>
                <button class="btn ghost" data-action="postpone">Перенести</button>
            </div>
        </section>`;
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
        <div class="bar ${over ? "over" : ""}"><i style="transform: scaleX(${(Math.min(100, planned / limit * 100)) / 100})"></i></div>
        ${isToday ? "" : `<button class="chip-btn back-today" data-day="0">К сегодня</button>`}
        <div id="installHint"></div>`;

    if (isToday) {
        const current = cardTask(now);
        // идущий фокус по задаче из «Дальше» открывается её кнопкой «Открыть таймер» — второй вход чипом не нужен
        const chip = current && state.focus?.taskId === current.task.id ? "" : focusChip();
        html += `<div class="today-tools">${tutorialChip()}${chip}${todayButton()}${dumpEntry()}${goalsChip()}</div>`
            + habitsStrip(now) + morningEntry(now) + eveningEntry(now);
        // раскладка «Фокус» (выбрана на стенде 20.10): одно дело крупно, остальное — полосами и свёрнутым днём
        if (current) {
            html += focusCard(current, now);
        }
        // выступление уже в карточке «Дальше» — полосу не дублируем
        if (current?.task.kind !== "show") {
            html += showDayStrip(now);
        }

        const late = overdueTasks(now).filter(task => !(task.plannedAt && task.plannedAt.startsWith(key)));
        if (late.length) {
            html += `<details class="day-fold overdue-fold"><summary><span>Просрочено</span><span class="mono">${late.length}</span></summary>` +
                late.map(task => row(task, { time: hasTime(task.plannedAt) ? timeText(task.plannedAt) : "", showDay: true })).join("") + `</details>`;
        }
    }

    if (!all.length) {
        html += `
            <div class="empty">
                <svg class="mark" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22"/><path d="M32 18v14l9 6"/></svg>
                <p>${isToday ? "На сегодня ничего. Добавь задачу кнопкой +." : "На этот день ничего не запланировано."}</p>
            </div>`;
    }

    const fold = isToday && all.length;
    if (fold) {
        const open = all.filter(task => !task.done).length;
        html += `<details class="day-fold" open><summary><span>Весь день</span><span class="mono">осталось ${open} из ${all.length}</span></summary>`;
    }

    if (timed.length) {
        html += fold ? "" : `<div class="label">День</div>`;
        let prevEnd = null;
        let nowShown = !isToday;
        for (const task of timed) {
            const start = parseDate(task.plannedAt);
            if (!nowShown && start > now) {
                html += `<div class="nowline"><span class="mono">${timeText(toIso(now))}</span></div>`;
                nowShown = true;
            }
            const gapFrom = prevEnd && (isToday && prevEnd < now ? now : prevEnd);
            // до выступления свободно только до выезда
            const gapTo = task.kind === "show" && departure(task) ? departure(task) : start;
            if (gapFrom && minutesBetween(gapFrom, gapTo) >= 15) {
                html += `<div class="gap mono">свободно ${durationText(minutesBetween(gapFrom, gapTo))}</div>`;
            }
            const end = endOf(task);
            html += row(task, { time: timeText(task.plannedAt), missed: isToday && !task.done && end < now });
            prevEnd = prevEnd && prevEnd > end ? prevEnd : end;
        }
        if (!nowShown) {
            html += `<div class="nowline"><span class="mono">${timeText(toIso(now))}</span></div>`;
        }
    }

    if (anytime.length) {
        html += `<div class="label">В течение дня</div>` + anytime.map(task => row(task, { time: "" })).join("");
    }
    if (fold) {
        html += `</details>`;
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
            side: `<span class="side"><button class="chip-btn" data-action="today">Сегодня</button><button class="chip-btn" data-action="tomorrow">Завтра</button></span>`
        })).join("") : `
            <div class="empty">
                <svg class="mark" viewBox="0 0 64 64"><path d="M10 36l8-20h28l8 20v14H10z"/><path d="M10 36h13l3 5h12l3-5h13"/></svg>
                <p>Пусто. Всё разложено по дням.</p>
            </div>`}
        ${later.length ? `<div class="label">Начать позже</div>` + later.map(task => row(task, {
            side: `<span class="chip-btn side later mono">с ${esc(relativeDay(task.start))}</span>`
        })).join("") : ""}`;
}

