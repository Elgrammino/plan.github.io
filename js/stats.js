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

export function statsSheet() {
    const now = new Date();
    const count = doneCounts(now);
    const sum = days => Array.from({ length: days }, (_, i) => count(dayKey(addDays(now, -i)))).reduce((a, b) => a + b, 0);
    const days = Array.from({ length: DAYS }, (_, i) => addDays(now, i - DAYS + 1));
    const max = Math.max(1, ...days.map(day => count(dayKey(day))));
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
            <div class="chart" role="img" aria-label="Сделано по дням за две недели">
                ${days.map(day => {
                    const value = count(dayKey(day));
                    return `<div class="col ${dayKey(day) === dayKey(now) ? "today" : ""}">
                        <span class="mono v">${value || ""}</span>
                        <i style="height: ${value / max * 100}%"></i>
                        <span class="d">${day.toLocaleDateString("ru-RU", { weekday: "short" }).slice(0, 2)}</span>
                    </div>`;
                }).join("")}
            </div>
            <p class="hint">Серия: <b class="mono">${series}</b> ${plural(series, "день", "дня", "дней")} подряд хотя&nbsp;бы с&nbsp;одной сделанной задачей.</p>

            <div class="label">Фокус</div>
            <div class="journal-sum compact">
                ${tile(durationText(focusMinutes(since(1))) || "0", "сегодня")}${tile(durationText(focusMinutes(since(7))) || "0", "за&nbsp;7 дней")}${tile(durationText(focusMinutes(since(30))) || "0", "за&nbsp;30 дней")}
            </div>
            ${topFocus.length ? topFocus.map(([id, minutes]) => `
                <div class="stat-row"><span>${esc(state.tasks.get(id)?.title || "удалённая задача")}</span><span class="mono text-2">${durationText(minutes)}</span></div>`).join("")
                : `<p class="hint">Таймер фокуса запускается кнопкой «Фокус» в&nbsp;блоке «Сейчас» или в&nbsp;карточке задачи.</p>`}

            <div class="label">Привычки</div>
            ${state.habits.map(habit => {
                const percent = rate(habit);
                return `<div class="stat-row"><span>${esc(habit.title)}</span><span class="mono text-2">серия ${streak(habit)}${percent !== null ? " · " + percent + "%" : ""}</span></div>`;
            }).join("") || `<p class="hint">Привычек пока нет: «Ещё → Привычки».</p>`}
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`);
    sheet.classList.add("tall");
    sheet.querySelector("[data-close]").addEventListener("click", close);
}

