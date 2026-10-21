// Статистика: сделанное по дням, время фокуса, серия дней, привычки.
import { addDays, dayKey, durationText, plural } from "./dates.js";
import { rate, streak } from "./habits.js";
import { doneByDay, state } from "./store.js";
import { esc, openSheet } from "./ui.js";

const DAYS = 14;

function doneCounts(now) {
    const counts = new Map(doneByDay(60, now).map(group => [group.day, group.tasks.length]));
    return day => counts.get(day) || 0;
}

function focusMinutes(sinceKey) {
    return state.focusLog.filter(entry => entry.day >= sinceKey).reduce((sum, entry) => sum + entry.minutes, 0);
}

// дни подряд хотя бы с одной сделанной задачей; сегодняшний ноль серию ещё не рвёт
function doneStreak(count, now) {
    let day = count(dayKey(now)) ? now : addDays(now, -1);
    let days = 0;
    while (count(dayKey(day))) {
        days++;
        day = addDays(day, -1);
    }
    return days;
}

// столбики по дням (один ряд, без легенды): подписаны только сегодня и максимум,
// любое значение — касанием по столбику; полный список значений — в aria-label для VoiceOver
function columns(days, value, format, now, title) {
    const values = days.map(day => value(dayKey(day)));
    const max = Math.max(1, ...values);
    const maxIndex = values.indexOf(Math.max(...values));
    const todayKey = dayKey(now);
    const name = day => day.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
    const spoken = days.map((day, i) => `${name(day)}: ${format(values[i]) || "0"}`).join("; ");
    return `
        <div class="chart" role="img" aria-label="${esc(title)}. ${esc(spoken)}">
            ${days.map((day, i) => {
                const today = dayKey(day) === todayKey;
                const labelled = values[i] && (today || i === maxIndex);
                return `<button class="col ${today ? "today" : ""}" data-col="${esc(name(day))} · ${esc(format(values[i]) || "0")}" aria-hidden="true" tabindex="-1">
                    <span class="mono v">${labelled ? esc(format(values[i])) : ""}</span>
                    <i style="transform: scaleY(${values[i] / max})"></i>
                    <span class="d">${day.toLocaleDateString("ru-RU", { weekday: "short" }).slice(0, 2)}</span>
                </button>`;
            }).join("")}
        </div>
        ${values.some(Boolean) ? `<p class="chart-readout" aria-hidden="true">Нажми на столбик — покажу день</p>` : `<p class="chart-readout" aria-hidden="true">Пока пусто</p>`}`;
}

// «на что ушёл фокус»: полоски по убыванию, длина — доля от лидера
function barList(rows) {
    const max = Math.max(1, ...rows.map(([, minutes]) => minutes));
    return `<div class="bar-list">${rows.map(([title, minutes]) => `
        <div class="bar-row">
            <div class="bar-row-text"><span>${esc(title)}</span><span class="mono text-2">${durationText(minutes)}</span></div>
            <i style="transform: scaleX(${minutes / max})"></i>
        </div>`).join("")}</div>`;
}

export function statsSheet() {
    const now = new Date();
    const count = doneCounts(now);
    const sum = days => Array.from({ length: days }, (_, i) => count(dayKey(addDays(now, -i)))).reduce((a, b) => a + b, 0);
    const days = Array.from({ length: DAYS }, (_, i) => addDays(now, i - DAYS + 1));
    const focusByDay = new Map();
    state.focusLog.forEach(entry => focusByDay.set(entry.day, (focusByDay.get(entry.day) || 0) + entry.minutes));
    const since = days => dayKey(addDays(now, -days + 1));

    // на что ушёл фокус за 30 дней
    const byTask = new Map();
    state.focusLog.filter(entry => entry.day >= since(30)).forEach(entry => byTask.set(entry.taskId, (byTask.get(entry.taskId) || 0) + entry.minutes));
    const topFocus = [...byTask].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const series = doneStreak(count, now);
    const tile = (value, label) => `<div><span class="mono">${value}</span><small>${label}</small></div>`;
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Статистика</h2>
            <div class="label">Сделано</div>
            <div class="journal-sum">
                ${tile(sum(1), "сегодня")}${tile(sum(7), "за&nbsp;7 дней")}${tile(sum(30), "за&nbsp;30 дней")}
            </div>
            ${columns(days, count, value => value ? String(value) : "", now, "Сделано по дням за две недели")}
            <p class="hint">Серия: <b class="mono">${series}</b> ${plural(series, "день", "дня", "дней")} подряд хотя&nbsp;бы с&nbsp;одной сделанной задачей.</p>

            <div class="label">Фокус</div>
            <div class="journal-sum compact">
                ${tile(durationText(focusMinutes(since(1))) || "0 мин", "сегодня")}${tile(durationText(focusMinutes(since(7))) || "0 мин", "за&nbsp;7 дней")}${tile(durationText(focusMinutes(since(30))) || "0 мин", "за&nbsp;30 дней")}
            </div>
            ${columns(days, day => focusByDay.get(day) || 0, durationText, now, "Фокус по дням за две недели")}
            ${topFocus.length ? `<div class="label">На что ушёл фокус за&nbsp;30 дней</div>` + barList(topFocus.map(([id, minutes]) => [state.tasks.get(id)?.title || "удалённая задача", minutes]))
                : `<p class="hint">Фокус запускается кнопкой «Приступить» на&nbsp;«Сегодня» или часиками в&nbsp;карточке задачи.</p>`}

            <div class="label">Привычки</div>
            ${state.habits.map(habit => {
                const percent = rate(habit);
                return `<div class="stat-row"><span>${esc(habit.title)}</span><span class="mono text-2">серия ${streak(habit)}${percent !== null ? " · " + percent + "%" : ""}</span></div>`;
            }).join("") || `<p class="hint">Привычек пока нет: «Ещё → Привычки».</p>`}
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Закрыть</button></div>`);
    sheet.classList.add("tall");
    sheet.querySelector("[data-close]").addEventListener("click", close);
    // касание по столбику: день и значение в строке под этим графиком
    sheet.addEventListener("click", event => {
        const col = event.target.closest("[data-col]");
        if (!col) {
            return;
        }
        const chart = col.closest(".chart");
        chart.querySelectorAll(".col.sel").forEach(item => item.classList.remove("sel"));
        col.classList.add("sel");
        chart.nextElementSibling.textContent = col.dataset.col;
    });
}

