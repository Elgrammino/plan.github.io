// Месячная сетка — общая для «Календаря» и «Контента», и сама вкладка «Календарь» с видами
// день (сетка часов), неделя (7 дней с загрузкой) и месяц; везде видны будущие разы повторов.
import { addDays, dayKey, dayOf, durationText, hasTime, parseDate, timeText } from "./dates.js";
import { nextDate, repeatText } from "./repeat.js";
import { row } from "./screens.js";
import { editTask, quickAdd } from "./sheets.js";
import { newTask, state } from "./store.js";
import { esc, escTitle, ICONS } from "./ui.js";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

// marks: Map день → html внутри клетки
export function monthGrid(month, selected, marks) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const weeks = Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7);
    const today = dayKey(new Date());
    const title = first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", "");
    let cells = "";
    for (let i = 0; i < weeks * 7; i++) {
        const day = addDays(start, i);
        const key = dayKey(day);
        const cls = [day.getMonth() !== month.getMonth() && "out", key === today && "today", key === selected && "sel"].filter(Boolean).join(" ");
        cells += `<button class="day ${cls}" data-pick="${key}"><span class="n">${day.getDate()}</span><span class="marks">${marks.get(key) || ""}</span></button>`;
    }
    return `
        <div class="month">
            <div class="month-head">
                <button class="icon-btn" data-month="-1" aria-label="Предыдущий месяц">${ICONS.prev}</button>
                <span class="month-title">${esc(title.charAt(0).toUpperCase() + title.slice(1))}</span>
                <button class="icon-btn" data-month="1" aria-label="Следующий месяц">${ICONS.next}</button>
            </div>
            <div class="month-grid">${WEEKDAYS.map(name => `<span class="wd">${name}</span>`).join("")}${cells}</div>
        </div>`;
}

// задачи в диапазоне дней плюс будущие разы повторов (их ещё нет в плане)
export function occurrences(fromKey, toKey, filter = () => true) {
    const items = [];
    state.tasks.forEach(task => {
        if (task.deletedAt || !task.plannedAt || !filter(task)) {
            return;
        }
        const key = dayOf(task.plannedAt);
        if (key >= fromKey && key <= toKey) {
            items.push({ task, day: key, virtual: false });
        }
        if (!task.repeat || task.done) {
            return;
        }
        let at = parseDate(task.plannedAt);
        for (let guard = 0; guard < 400; guard++) {
            at = nextDate(task.repeat, at);
            const next = dayKey(at);
            if (next > toKey) {
                break;
            }
            if (next >= fromKey) {
                items.push({ task, day: next, virtual: true });
            }
        }
    });
    return items;
}

export function monthRange(month) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    return [dayKey(addDays(first, -7)), dayKey(addDays(new Date(month.getFullYear(), month.getMonth() + 1, 0), 7))];
}

// ---- вкладка «Календарь»: день, неделя, месяц ----
const MODES = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]];

let mode = "week";
let month = new Date();
let selected = dayKey(new Date());

const timeOf = item => hasTime(item.task.plannedAt) ? timeText(item.task.plannedAt) : "99";
const byTime = (a, b) => timeOf(a).localeCompare(timeOf(b));

function groupByDay(items) {
    const byDay = new Map();
    items.forEach(item => byDay.has(item.day) ? byDay.get(item.day).push(item) : byDay.set(item.day, [item]));
    byDay.forEach(list => list.sort(byTime));
    return byDay;
}

// будущий раз повтора: строка без отметки, по нажатию открывается сама повторяющаяся задача
function virtualRow(task) {
    return `
        <div class="item virtual" data-id="${task.id}">
            <span class="time mono">${hasTime(task.plannedAt) ? timeText(task.plannedAt) : ""}</span>
            <span class="check" aria-hidden="true"></span>
            <button class="body" data-action="edit">
                <div class="name">${escTitle(task.title)}</div>
                <div class="sub">↻ ${esc(repeatText(task.repeat))} · появится, когда отметишь предыдущий раз</div>
            </button>
        </div>`;
}

const dayRows = list => list.map(({ task, virtual }) => virtual ? virtualRow(task)
    : row(task, { time: hasTime(task.plannedAt) ? timeText(task.plannedAt) : "" })).join("");

function nav(title, step) {
    return `
        <div class="month-head">
            <button class="icon-btn" data-step="-${step}" aria-label="Назад">${ICONS.prev}</button>
            <span class="month-title">${esc(title)}</span>
            <button class="icon-btn" data-step="${step}" aria-label="Вперёд">${ICONS.next}</button>
        </div>`;
}

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
const minutesPlanned = list => list.filter(item => !item.task.done).reduce((sum, item) => sum + (item.task.durationMin || 0), 0);
const clock = date => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

function loadLine(planned) {
    const limit = state.settings.dayLimitMin;
    return `
        <div class="load"><span>${planned > limit ? "Больше лимита на " + durationText(planned - limit) : "Загрузка дня"}</span>
            <span class="mono">${durationText(planned) || "0 ч"} из ${durationText(limit)}</span></div>
        <div class="bar ${planned > limit ? "over" : ""}"><i style="transform: scaleX(${(Math.min(100, planned / limit * 100)) / 100})"></i></div>`;
}

// ---- месяц ----
function monthView() {
    const [from, to] = monthRange(month);
    const byDay = groupByDay(occurrences(from, to));
    const marks = new Map([...byDay].map(([key, list]) => [key, list.slice(0, 3).map(item =>
        `<i class="${item.virtual ? "virtual" : ""} ${item.task.kind === "show" ? "show" : ""} ${item.task.done ? "done" : ""}"></i>`).join("")]));
    const date = parseDate(selected).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    return monthGrid(month, selected, marks) +
        `<div class="label">${esc(date)}</div>` +
        (dayRows(byDay.get(selected) || []) || `<p class="search-empty">На этот день ничего. «+» добавит задачу сюда.</p>`);
}

// ---- неделя: 7 строк-дней с загрузкой; на телефоне так читается лучше семи узких колонок ----
function weekView() {
    const monday = addDays(parseDate(selected), -((parseDate(selected).getDay() + 6) % 7));
    const sunday = addDays(monday, 6);
    const byDay = groupByDay(occurrences(dayKey(monday), dayKey(sunday)));
    const limit = state.settings.dayLimitMin;
    const today = dayKey(new Date());
    const sameMonth = monday.getMonth() === sunday.getMonth();
    const title = `${monday.getDate()}${sameMonth ? "" : " " + monday.toLocaleDateString("ru-RU", { month: "short" })} – ${sunday.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
    let html = nav(title, 7);
    for (let i = 0; i < 7; i++) {
        const day = addDays(monday, i);
        const key = dayKey(day);
        const list = byDay.get(key) || [];
        const planned = minutesPlanned(list);
        html += `
            <div class="week-day ${key === today ? "today" : ""} ${key < today ? "past" : ""}">
                <button class="week-head" data-open-day="${key}">
                    <span class="week-name">${esc(capital(day.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric" })))}</span>
                    <span class="mono text-2">${planned ? durationText(planned) : ""}</span>
                </button>
                ${planned ? `<div class="bar ${planned > limit ? "over" : ""}"><i style="transform: scaleX(${(Math.min(100, planned / limit * 100)) / 100})"></i></div>` : ""}
                ${list.map(({ task, virtual }) => `
                    <button class="week-task ${virtual ? "virtual" : ""} ${task.done ? "done" : key < today && !virtual ? "late" : ""} ${task.kind === "show" ? "show" : ""}" data-id="${task.id}" data-action="edit">
                        <span class="mono">${hasTime(task.plannedAt) ? timeText(task.plannedAt) : "·"}</span>${esc(task.title)}${virtual ? " ↻" : ""}
                    </button>`).join("") || `<p class="week-empty">—</p>`}
            </div>`;
    }
    return html;
}

// ---- день: рабочие часы (9:00–20:00 из настроек) на всю высоту экрана, задачи — блоками по времени и длине ----
// Положение в процентах от сетки, высоту сетки подгоняет fitDayGrid() под экран. Что раньше или позже — строками.
const minutesOf = time => time.split(":").reduce((h, m) => h * 60 + +m);

function dayView() {
    const date = parseDate(selected);
    const list = groupByDay(occurrences(selected, selected)).get(selected) || [];
    const timed = list.filter(item => hasTime(item.task.plannedAt));
    const anytime = list.filter(item => !hasTime(item.task.plannedAt));
    const startOf = item => parseDate(item.task.plannedAt).getHours() * 60 + parseDate(item.task.plannedAt).getMinutes();
    const from = minutesOf(state.settings.dayStart);
    const to = Math.max(from + 60, minutesOf(state.settings.dayEnd));
    const pct = value => ((Math.min(to, Math.max(from, value)) - from) / (to - from) * 100).toFixed(3) + "%";

    const all = timed.map(item => ({ item, start: startOf(item), end: startOf(item) + Math.max(15, item.task.durationMin || 30) }))
        .sort((a, b) => a.start - b.start);
    const before = all.filter(block => block.end <= from).map(block => block.item);
    const after = all.filter(block => block.start >= to).map(block => block.item);
    const blocks = all.filter(block => block.end > from && block.start < to);

    // пересекающиеся задачи встают рядом: колонки раздаются жадно внутри группы пересечений
    let group = [];
    let groupEnd = -1;
    const flush = () => {
        const columns = Math.max(...group.map(block => block.col)) + 1;
        group.forEach(block => block.cols = columns);
        group = [];
    };
    blocks.forEach(block => {
        if (group.length && block.start >= groupEnd) {
            flush();
        }
        const used = new Set(group.filter(other => other.end > block.start).map(other => other.col));
        block.col = 0;
        while (used.has(block.col)) {
            block.col++;
        }
        group.push(block);
        groupEnd = Math.max(groupEnd, block.end);
    });
    if (group.length) {
        flush();
    }

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let hours = "";
    for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) {
        hours += `<div class="hour" style="top: ${pct(m)}"><span class="mono">${String(m / 60).padStart(2, "0")}:00</span></div>`;
    }
    const outside = (items, label) => items.length ? `<div class="label">${label}</div>` + dayRows(items) : "";

    return nav(capital(date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })), 1) +
        loadLine(minutesPlanned(list)) +
        (anytime.length ? `<div class="label">В течение дня</div>` + dayRows(anytime) : "") +
        outside(before, `Раньше ${state.settings.dayStart}`) + `
        <div class="day-grid">
            ${hours}
            ${selected === dayKey(now) && nowMin >= from && nowMin <= to ? `<div class="grid-now" style="top: ${pct(nowMin)}"></div>` : ""}
            ${blocks.map(({ item, start, end, col, cols }) => {
                const begin = parseDate(item.task.plannedAt);
                const short = Math.min(end, to) - Math.max(start, from) < 50;
                // у короткой задачи время в строку с названием — только начало, иначе не влезает
                const finish = item.task.durationMin && !short ? "–" + clock(new Date(begin.getTime() + item.task.durationMin * 60000)) : "";
                return `
                <button class="block ${short ? "short" : ""} ${cols >= 3 ? "narrow" : ""} ${item.virtual ? "virtual" : ""} ${item.task.done ? "done" : ""} ${item.task.kind === "show" ? "show" : ""}"
                        data-id="${item.task.id}" data-action="edit"
                        style="top: ${pct(start)}; height: calc(${pct(end)} - ${pct(start)} - 2px); left: calc(52px + (100% - 52px) * ${col / cols}); width: calc((100% - 52px) / ${cols} - 3px)">
                    <span class="block-title">${esc(item.task.title)}${item.virtual ? " ↻" : ""}</span>
                    <span class="mono block-time">${clock(begin)}${finish}</span>
                </button>`;
            }).join("")}
        </div>` +
        outside(after, `После ${state.settings.dayEnd}`);
}

// сетка дня — ровно до нижней панели: весь рабочий день виден без прокрутки
export function fitDayGrid() {
    const grid = document.querySelector("#calendar:not([hidden]) .day-grid");
    if (!grid) {
        return;
    }
    const bar = document.querySelector(".tabbar")?.getBoundingClientRect().top ?? window.innerHeight;
    // от верха документа, а не окна: под шторкой body зафиксирован и окно «прокручено» через top
    const top = grid.getBoundingClientRect().top - document.body.getBoundingClientRect().top;
    const tail = grid.nextElementSibling ? 0 : 24; // под сеткой ничего — оставляем воздух до панели
    grid.style.height = Math.max(440, bar - top - tail - 8) + "px";
}

export function renderCalendar(el) {
    el.innerHTML = `
        <h1 class="title">Календарь</h1>
        <div class="segmented">${MODES.map(([id, label]) => `<button data-mode="${id}" ${id === mode ? 'aria-current="true"' : ""}>${label}</button>`).join("")}</div>
        ${mode === "day" ? dayView() : mode === "week" ? weekView() : monthView()}`;
    if (mode === "day") {
        requestAnimationFrame(fitDayGrid);
    }
}

export function onCalendarClick(event, rerender) {
    const modeButton = event.target.closest("[data-mode]");
    const step = event.target.closest("[data-step]");
    const shift = event.target.closest("[data-month]");
    const pick = event.target.closest("[data-pick]");
    const openDay = event.target.closest("[data-open-day]");
    if (modeButton) {
        mode = modeButton.dataset.mode;
    } else if (step) {
        selected = dayKey(addDays(parseDate(selected), +step.dataset.step));
    } else if (shift) {
        month = new Date(month.getFullYear(), month.getMonth() + +shift.dataset.month, 1);
    } else if (pick) {
        selected = pick.dataset.pick;
    } else if (openDay) {
        selected = openDay.dataset.openDay;
        mode = "day";
    } else {
        return false;
    }
    // месяц следует за выбранным днём
    const date = parseDate(selected);
    if (!shift && date.getMonth() !== month.getMonth()) {
        month = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    rerender();
    return true;
}

// «+» на вкладке: новая задача на выбранный день
export function addOnSelected() {
    quickAdd({ day: selected }); // тот же быстрый ввод, что на «Сегодня»: фраза разбирается
}

window.addEventListener("resize", fitDayGrid);
