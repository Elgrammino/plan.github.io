// Месячная сетка — общая для «Календаря» и «Контента», и сама вкладка «Календарь»:
// месяц с отметками, ниже — задачи выбранного дня, включая будущие разы повторов.
import { addDays, dayKey, dayOf, hasTime, parseDate, timeText } from "./dates.js";
import { nextDate, repeatText } from "./repeat.js";
import { row } from "./screens.js";
import { editTask } from "./sheets.js";
import { newTask, state } from "./store.js";
import { ICONS, esc } from "./ui.js";

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

// ---- вкладка «Календарь» ----
let month = new Date();
let selected = dayKey(new Date());

export function renderCalendar(el) {
    const [from, to] = monthRange(month);
    const items = occurrences(from, to);
    const byDay = new Map();
    items.forEach(item => byDay.has(item.day) ? byDay.get(item.day).push(item) : byDay.set(item.day, [item]));
    const marks = new Map([...byDay].map(([key, list]) => [key, list.slice(0, 3).map(item =>
        `<i class="${item.virtual ? "virtual" : ""} ${item.task.kind === "show" ? "show" : ""} ${item.task.done ? "done" : ""}"></i>`).join("")]));

    const day = (byDay.get(selected) || []).sort((a, b) => {
        const time = item => hasTime(item.task.plannedAt) ? timeText(item.task.plannedAt) : "99";
        return time(a).localeCompare(time(b));
    });
    const date = parseDate(selected).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

    el.innerHTML = `
        <h1 class="title">Календарь</h1>
        ${monthGrid(month, selected, marks)}
        <div class="label">${esc(date)}</div>
        ${day.map(({ task, virtual }) => virtual ? `
            <div class="item virtual" data-id="${task.id}">
                <span class="time mono">${hasTime(task.plannedAt) ? timeText(task.plannedAt) : ""}</span>
                <span class="check" aria-hidden="true"></span>
                <button class="body" data-action="edit">
                    <div class="name">${esc(task.title)}</div>
                    <div class="sub">↻ ${esc(repeatText(task.repeat))} · появится, когда отметишь предыдущий раз</div>
                </button>
            </div>` : row(task, { time: hasTime(task.plannedAt) ? timeText(task.plannedAt) : "" })).join("")
        || `<p class="search-empty">На этот день ничего. «+» добавит задачу сюда.</p>`}`;
}

export function onCalendarClick(event, rerender) {
    const shift = event.target.closest("[data-month]");
    const pick = event.target.closest("[data-pick]");
    if (shift) {
        month = new Date(month.getFullYear(), month.getMonth() + +shift.dataset.month, 1);
    } else if (pick) {
        selected = pick.dataset.pick;
        const date = parseDate(selected);
        if (date.getMonth() !== month.getMonth()) {
            month = new Date(date.getFullYear(), date.getMonth(), 1);
        }
    } else {
        return false;
    }
    rerender();
    return true;
}

// «+» на вкладке: новая задача на выбранный день
export function addOnSelected() {
    editTask(newTask({ plannedAt: selected }));
}
