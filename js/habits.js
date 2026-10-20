// Привычки: ежедневные, по дням недели или N раз в неделю. Серии и процент выполнения.
// В Напоминания не уходят (решение из журнала) — отмечаются полоской на «Сегодня».
import { addDays, dayKey, plural } from "./dates.js";
import { WEEKDAYS, WEEKDAY_SHORT, weekdayCode } from "./repeat.js";
import { onChange, saveHabits, state } from "./store.js";
import { ICONS, esc, haptic, openSheet, showToast } from "./ui.js";

const KINDS = [["daily", "Каждый день"], ["days", "По дням"], ["weekly", "Раз в неделю N раз"]];

const doneOn = (habit, key) => (state.habitLog[habit.id] || []).includes(key);
const monday = date => addDays(date, -((date.getDay() + 6) % 7));

function weekCount(habit, date) {
    const start = monday(date);
    let count = 0;
    for (let i = 0; i < 7; i++) {
        count += doneOn(habit, dayKey(addDays(start, i))) ? 1 : 0;
    }
    return count;
}

// нужна ли привычка в этот день (для еженедельной — пока норма недели не набрана или уже отмечена сегодня)
function dueOn(habit, date) {
    if (habit.kind === "days") {
        return (habit.weekdays || []).includes(weekdayCode(date));
    }
    if (habit.kind === "weekly") {
        return weekCount(habit, date) < (habit.perWeek || 1) || doneOn(habit, dayKey(date));
    }
    return true;
}

// серия: дни (или недели) подряд, сегодняшний пропуск ещё не рвёт серию
export function streak(habit, now = new Date()) {
    let count = 0;
    if (habit.kind === "weekly") {
        let week = monday(now);
        if (weekCount(habit, week) < (habit.perWeek || 1)) {
            week = addDays(week, -7); // текущая неделя ещё не закончена
        }
        while (dayKey(addDays(week, 6)) >= habit.since && weekCount(habit, week) >= (habit.perWeek || 1)) {
            count++;
            week = addDays(week, -7);
        }
        return count;
    }
    let day = new Date(now);
    if (!doneOn(habit, dayKey(day))) {
        day = addDays(day, -1);
    }
    for (; dayKey(day) >= habit.since; day = addDays(day, -1)) {
        if (!dueOn(habit, day)) {
            continue;
        }
        if (!doneOn(habit, dayKey(day))) {
            break;
        }
        count++;
    }
    return count;
}

// процент за 30 дней: сделано из положенного (сегодня считается, только если уже отмечено)
export function rate(habit, now = new Date()) {
    if (habit.kind === "weekly") {
        let met = 0;
        let weeks = 0;
        for (let i = 1; i <= 4; i++) {
            const week = addDays(monday(now), -7 * i);
            if (dayKey(addDays(week, 6)) < habit.since) {
                break;
            }
            weeks++;
            met += weekCount(habit, week) >= (habit.perWeek || 1) ? 1 : 0;
        }
        return weeks ? Math.round(met / weeks * 100) : null;
    }
    let due = 0;
    let done = 0;
    for (let i = 0; i < 30; i++) {
        const day = addDays(now, -i);
        const key = dayKey(day);
        if (key < habit.since || (i === 0 && !doneOn(habit, key)) || !dueOn(habit, day)) {
            continue;
        }
        due++;
        done += doneOn(habit, key) ? 1 : 0;
    }
    return due ? Math.round(done / due * 100) : null;
}

function toggleHabit(habit, key = dayKey(new Date())) {
    const log = state.habitLog[habit.id] || (state.habitLog[habit.id] = []);
    const index = log.indexOf(key);
    index === -1 ? log.push(key) : log.splice(index, 1);
    return saveHabits();
}

// ---- полоска на «Сегодня» ----
export function habitsStrip(now = new Date()) {
    const key = dayKey(now);
    const today = state.habits.filter(habit => dueOn(habit, now));
    if (!today.length) {
        return "";
    }
    return `<div class="habits-strip">${today.map(habit => {
        const done = doneOn(habit, key);
        const week = habit.kind === "weekly" ? ` <span class="mono">${weekCount(habit, now)}/${habit.perWeek}</span>` : "";
        return `<button class="habit-chip ${done ? "done" : ""}" data-habit="${habit.id}" aria-pressed="${done}">${esc(habit.title)}${week}</button>`;
    }).join("")}</div>`;
}

export function onHabitClick(event) {
    const chip = event.target.closest("[data-habit]");
    if (!chip) {
        return false;
    }
    haptic();
    const habit = state.habits.find(item => item.id === chip.dataset.habit);
    if (habit) {
        toggleHabit(habit);
    }
    return true;
}

// ---- управление ----
function kindText(habit) {
    if (habit.kind === "days") {
        return "по " + (habit.weekdays || []).map(day => WEEKDAY_SHORT[day]).join(", ");
    }
    if (habit.kind === "weekly") {
        return `${habit.perWeek} ${plural(habit.perWeek, "раз", "раза", "раз")} в неделю`;
    }
    return "каждый день";
}

export function habitsSheet() {
    let unsubscribe = () => { };
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Привычки</h2>
            <p class="hint">Отмечаются полоской на&nbsp;«Сегодня». В&nbsp;Напоминания не&nbsp;уходят.</p>
            <div id="habits"></div>
            <button class="btn ghost wide" id="newHabit" style="margin-top: var(--sp-16)">Новая привычка</button>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`,
        { onClose: () => unsubscribe() });
    sheet.classList.add("tall");
    const render = () => {
        const today = new Date();
        sheet.querySelector("#habits").innerHTML = state.habits.map(habit => {
            const percent = rate(habit);
            // последние 14 дней точками: сделано, пропущено, не нужно
            const dots = Array.from({ length: 14 }, (_, i) => {
                const day = addDays(today, i - 13);
                const key = dayKey(day);
                const cls = key < habit.since ? "none" : doneOn(habit, key) ? "on" : habit.kind !== "weekly" && !dueOn(habit, day) ? "none" : "";
                return `<i class="${cls}"></i>`;
            }).join("");
            return `
                <button class="habit-row" data-edit-habit="${habit.id}">
                    <span class="what">
                        <span class="name">${esc(habit.title)}</span>
                        <span class="sub">${esc(kindText(habit))} · серия <span class="mono">${streak(habit)}</span>${percent !== null ? ` · <span class="mono">${percent}%</span>` : ""}</span>
                        <span class="habit-dots">${dots}</span>
                    </span>
                </button>`;
        }).join("") || `<p class="text-2">Привычек пока нет. Например: зарядка каждый день, тренировка 3 раза в неделю.</p>`;
    };
    sheet.querySelector("#habits").addEventListener("click", event => {
        const id = event.target.closest("[data-edit-habit]")?.dataset.editHabit;
        if (id) {
            editHabit(state.habits.find(habit => habit.id === id));
        }
    });
    sheet.querySelector("#newHabit").addEventListener("click", () => editHabit(null));
    sheet.querySelector("[data-close]").addEventListener("click", close);
    unsubscribe = onChange(render);
    render();
}

function editHabit(habit) {
    const start = habit || { kind: "daily", weekdays: [], perWeek: 3 };
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <input class="input" id="habitTitle" placeholder="Например, зарядка" value="${esc(start.title || "")}" autocomplete="off">
            <div class="field"><div class="label">Как часто</div>
                <div class="chips">${KINDS.map(([id, label]) => `
                    <label class="chip"><input type="radio" name="habitKind" value="${id}" ${id === start.kind ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
                <div class="chips" id="habitDays" style="margin-top: var(--sp-8)">${WEEKDAYS.map(code => `
                    <label class="chip"><input type="checkbox" value="${code}" ${(start.weekdays || []).includes(code) ? "checked" : ""}><span>${WEEKDAY_SHORT[code]}</span></label>`).join("")}</div>
                <div class="row" id="habitPerWeek" style="margin-top: var(--sp-8)">
                    <input class="input every" type="number" inputmode="numeric" min="1" max="7" id="perWeek" value="${start.perWeek || 3}">
                    <span class="text-2">раз в&nbsp;неделю, в&nbsp;любые дни</span>
                </div>
            </div>
        </div>
        <div class="sheet-foot">
            ${habit ? `<button class="icon-btn" id="habitDelete" aria-label="Удалить">${ICONS.trash}</button>` : ""}
            <button class="btn ghost grow" data-close>Отмена</button>
            <button class="btn primary grow" id="habitSave">Сохранить</button>
        </div>`);
    const $ = selector => sheet.querySelector(selector);
    const kind = () => sheet.querySelector('input[name="habitKind"]:checked').value;
    const sync = () => {
        $("#habitDays").hidden = kind() !== "days";
        $("#habitPerWeek").hidden = kind() !== "weekly";
    };
    sheet.addEventListener("change", sync);
    sync();
    if (!habit) {
        $("#habitTitle").focus();
    }
    sheet.querySelector("[data-close]").addEventListener("click", close);
    $("#habitSave").addEventListener("click", () => {
        const title = $("#habitTitle").value.trim();
        const weekdays = [...sheet.querySelectorAll("#habitDays input:checked")].map(input => input.value);
        if (!title || (kind() === "days" && !weekdays.length)) {
            showToast(title ? "Отметь хотя бы один день" : "Дай привычке название");
            return;
        }
        haptic();
        const fields = { title, kind: kind(), weekdays: kind() === "days" ? weekdays : [], perWeek: Math.min(7, Math.max(1, Math.round(+$("#perWeek").value) || 1)) };
        if (habit) {
            Object.assign(habit, fields);
        } else {
            state.habits.push({ id: "h-" + crypto.randomUUID().slice(0, 6), since: dayKey(new Date()), ...fields });
        }
        saveHabits();
        close();
    });
    $("#habitDelete")?.addEventListener("click", () => {
        haptic();
        const index = state.habits.indexOf(habit);
        state.habits.splice(index, 1);
        saveHabits();
        close();
        // отметки остаются в журнале: «Вернуть» восстанавливает и серию
        showToast(`Привычка «${habit.title}» удалена`, "Вернуть", () => {
            state.habits.splice(index, 0, habit);
            saveHabits();
        });
    });
}

