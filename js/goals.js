// Цели недели: 3–5 штук, задачи привязываются полем goal, прогресс — доля сделанных задач.
import { addDays, dayKey } from "./dates.js";
import { onChange, saveGoals, state } from "./store.js";
import { esc, haptic, openSheet, showToast } from "./ui.js";

const MAX = 5;

// неделя — это её понедельник
function weekKey(date = new Date()) {
    return dayKey(addDays(date, -((date.getDay() + 6) % 7)));
}

export function weekGoals(week = weekKey()) {
    return state.goals.filter(goal => goal.week === week);
}

export function goalProgress(goal) {
    const tasks = [...state.tasks.values()].filter(task => task.goal === goal.id && !task.deletedAt);
    return { done: tasks.filter(task => task.done).length, total: tasks.length };
}

export function goalsSheet() {
    let unsubscribe = () => { };
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Цели недели</h2>
            <p class="hint">3–5 штук. Задачи привязываются к&nbsp;цели в&nbsp;карточке задачи.</p>
            <div id="goals"></div>
            <div class="row" style="margin-top: var(--sp-12)" id="addRow">
                <input class="input" id="newGoal" enterkeyhint="done" placeholder="Например, снять 3 рилса" autocomplete="off">
                <button class="btn ghost" id="addGoal">Добавить</button>
            </div>
            <div id="lastWeek"></div>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`,
        { onClose: () => unsubscribe() });
    const $ = selector => sheet.querySelector(selector);

    const render = () => {
        const goals = weekGoals();
        $("#goals").innerHTML = goals.map(goal => {
            const { done, total } = goalProgress(goal);
            return `
                <div class="goal-row ${goal.done ? "done" : ""}" data-goal="${goal.id}">
                    <label class="goal-check"><input type="checkbox" data-done ${goal.done ? "checked" : ""} aria-label="Цель достигнута"></label>
                    <div class="what">
                        <div class="name">${esc(goal.title)}</div>
                        <div class="bar"><i style="width: ${total ? done / total * 100 : 0}%"></i></div>
                        <div class="sub mono">${total ? `${done} из ${total}` : "задач пока нет"}</div>
                    </div>
                    <button class="icon-btn" data-remove aria-label="Удалить">×</button>
                </div>`;
        }).join("") || `<p class="text-2">Целей на&nbsp;эту неделю пока нет.</p>`;
        $("#addRow").hidden = goals.length >= MAX;
        // незакрытые цели прошлой недели можно перенести
        const old = weekGoals(weekKey(addDays(new Date(), -7))).filter(goal => !goal.done && !goals.some(item => item.title === goal.title));
        $("#lastWeek").innerHTML = old.length && goals.length < MAX ? `
            <div class="label">С&nbsp;прошлой недели</div>
            <div class="chips">${old.map(goal => `<button class="chip-btn" data-carry="${goal.id}">+ ${esc(goal.title)}</button>`).join("")}</div>` : "";
    };

    const add = title => {
        if (!title || weekGoals().length >= MAX) {
            return;
        }
        haptic();
        state.goals.push({ id: "g-" + crypto.randomUUID().slice(0, 6), title, week: weekKey(), done: false });
        saveGoals();
    };
    $("#addGoal").addEventListener("click", () => {
        add($("#newGoal").value.trim());
        $("#newGoal").value = "";
    });
    $("#newGoal").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            add($("#newGoal").value.trim());
            $("#newGoal").value = "";
        }
    });
    $("#goals").addEventListener("change", event => {
        const goal = state.goals.find(item => item.id === event.target.closest("[data-goal]")?.dataset.goal);
        if (goal && event.target.matches("[data-done]")) {
            haptic();
            goal.done = event.target.checked;
            saveGoals();
        }
    });
    $("#goals").addEventListener("click", event => {
        if (!event.target.closest("[data-remove]")) {
            return;
        }
        const goal = state.goals.find(item => item.id === event.target.closest("[data-goal]").dataset.goal);
        const index = state.goals.indexOf(goal);
        state.goals.splice(index, 1);
        saveGoals();
        showToast(`Цель «${goal.title}» удалена`, "Вернуть", () => {
            state.goals.splice(index, 0, goal);
            saveGoals();
        });
    });
    $("#lastWeek").addEventListener("click", event => {
        const goal = state.goals.find(item => item.id === event.target.closest("[data-carry]")?.dataset.carry);
        if (goal) {
            add(goal.title);
        }
    });
    sheet.querySelector("[data-close]").addEventListener("click", close);
    unsubscribe = onChange(render);
    render();
}
