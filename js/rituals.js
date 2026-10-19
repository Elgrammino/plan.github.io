// Ритуалы. Утро: вчера → сегодня → что подождёт → зафиксировать.
// Вечер: что сделал → что переносим → что завтра → на ночь (выгрузка, Напоминания).
import { addDays, atTime, dayKey, dayOf, durationText, hasTime, parseDate, relativeDay, timeText, toIso } from "./dates.js";
import { openDump } from "./dump.js";
import { goalProgress, goalsSheet, weekGoals } from "./goals.js";
import { send } from "./notify.js";
import { quickAdd } from "./sheets.js";
import { dayTasks, doneByDay, inboxTasks, markRitual, onChange, overdueTasks, saveTask, setDone, state, trashTask } from "./store.js";
import { ICONS, esc, haptic, showToast } from "./ui.js";

const minutesOf = time => time.split(":").reduce((h, m) => h * 60 + +m);
const nowMinutes = now => now.getHours() * 60 + now.getMinutes();

// ---- входы на «Сегодня» ----
export function morningEntry(now = new Date()) {
    if (state.rituals.morning === dayKey(now) || nowMinutes(now) < minutesOf(state.settings.morning) || now.getHours() >= 13) {
        return "";
    }
    return `
        <div class="card notice ritual-call">
            <div>Утро. Пять минут: что осталось со&nbsp;вчера, что делаем сегодня.</div>
            <button class="btn primary" data-ritual="morning">Разобрать</button>
        </div>`;
}

export function eveningEntry(now = new Date()) {
    if (state.rituals.evening === dayKey(now) || nowMinutes(now) < minutesOf(state.settings.evening)) {
        return "";
    }
    return `
        <div class="card notice ritual-call">
            <div>Вечер. Закроем день: что сделал, что переносим, что завтра.</div>
            <button class="btn primary" data-ritual="evening">Закрыть день</button>
        </div>`;
}

export function goalsChip() {
    const goals = weekGoals();
    if (!goals.length) {
        // в начале недели напоминаем поставить цели
        return [1, 2].includes(new Date().getDay()) ? `<button class="chip-btn today-tool" data-goals>Цели недели</button>` : "";
    }
    return `<button class="chip-btn today-tool" data-goals>Цели · <span class="mono">${goals.filter(goal => goal.done).length}/${goals.length}</span></button>`;
}

export function onRitualClick(event) {
    const ritual = event.target.closest("[data-ritual]");
    if (ritual) {
        haptic();
        ritual.dataset.ritual === "morning" ? morning() : evening();
        return true;
    }
    if (event.target.closest("[data-goals]")) {
        goalsSheet();
        return true;
    }
    return false;
}

// ---- общий каркас: шаги на весь экран ----
let closeFlow = () => { };

function flow(steps, onFinish) {
    let current = 0;
    const root = document.createElement("div");
    root.className = "dump onboarding ritual";
    root.setAttribute("role", "dialog");
    document.body.append(root);
    document.body.style.overflow = "hidden";

    const close = () => {
        unsubscribe();
        root.remove();
        document.body.style.overflow = "";
    };
    closeFlow = close;
    const render = () => {
        const step = steps[current];
        const last = current === steps.length - 1;
        root.innerHTML = `
            <div class="dump-top">
                <button class="icon-btn" data-quit aria-label="Закрыть">${ICONS.close}</button>
                <span class="dots">${steps.map((_, i) => `<i class="${i === current ? "on" : i < current ? "past" : ""}"></i>`).join("")}</span>
                <span style="width: var(--tap)"></span>
            </div>
            <div class="onboarding-body">
                <h1 class="title">${step.title}</h1>
                ${step.body()}
            </div>
            <div class="btns onboarding-foot">
                ${current ? `<button class="btn ghost" data-prev>Назад</button>` : ""}
                <button class="btn primary" data-next>${last ? "Готово" : "Дальше"}</button>
            </div>`;
    };
    root.addEventListener("click", event => {
        if (event.target.closest("[data-quit]")) {
            close();
        } else if (event.target.closest("[data-prev]")) {
            current--;
            render();
        } else if (event.target.closest("[data-next]")) {
            haptic();
            if (current === steps.length - 1) {
                onFinish();
                close();
            } else {
                current++;
                render();
                root.scrollTop = 0;
            }
        } else {
            steps[current].click?.(event);
        }
    });
    // правки задач в шагах сразу видны
    const unsubscribe = onChange(render);
    render();
}

// ---- строка задачи с кнопками ----
const when = task => task.plannedAt ? relativeDay(task.plannedAt) + (hasTime(task.plannedAt) ? " " + timeText(task.plannedAt) : "") : "без дня";

function row(task, buttons, sub = when(task)) {
    return `
        <div class="ritual-row" data-id="${task.id}">
            <div class="what">
                <div class="name">${esc(task.title)}</div>
                <div class="sub">${esc(sub)}${task.durationMin ? " · " + durationText(task.durationMin) : ""}</div>
            </div>
            <div class="ritual-btns">${buttons.map(([act, label]) => `<button class="chip-btn" data-act="${act}">${label}</button>`).join("")}</div>
        </div>`;
}

// перенести на день, сохранив время суток
function moveTo(task, day) {
    task.plannedAt = !day ? null
        : hasTime(task.plannedAt) ? toIso(atTime(day, parseDate(task.plannedAt).getHours(), parseDate(task.plannedAt).getMinutes()))
        : dayKey(day);
    return saveTask(task);
}

// общие действия строк
function act(event) {
    const button = event.target.closest("[data-act]");
    const task = button && state.tasks.get(button.closest("[data-id]").dataset.id);
    if (!task) {
        return false;
    }
    haptic();
    const today = new Date();
    switch (button.dataset.act) {
        case "today": moveTo(task, today); break;
        case "tomorrow": moveTo(task, addDays(today, 1)); break;
        case "inbox": moveTo(task, null); break;
        case "done": setDone(task, true); break;
        case "trash":
            trashTask(task);
            showToast("В корзине", "Вернуть", () => { task.deletedAt = null; saveTask(task); });
            break;
    }
    return true;
}

function load(key) {
    const { timed, anytime } = dayTasks(key);
    const minutes = [...timed, ...anytime].filter(task => !task.done).reduce((sum, task) => sum + (task.durationMin || 0), 0);
    const limit = state.settings.dayLimitMin;
    return { tasks: [...timed, ...anytime], minutes, limit, over: minutes - limit };
}

function loadBar({ minutes, limit, over }) {
    return `
        <div class="load"><span>${over > 0 ? "Больше лимита на " + durationText(over) : "Влезает в&nbsp;лимит"}</span>
            <span class="mono">${durationText(minutes) || "0 ч"} из ${durationText(limit)}</span></div>
        <div class="bar ${over > 0 ? "over" : ""}"><i style="width: ${Math.min(100, minutes / limit * 100)}%"></i></div>`;
}

function goalsLine() {
    const goals = weekGoals();
    if (!goals.length) {
        return `<button class="chip-btn" data-goals-edit>Поставить цели недели</button>`;
    }
    return `<div class="label">Цели недели</div>` + goals.map(goal => {
        const { done, total } = goalProgress(goal);
        return `<div class="goal-line ${goal.done ? "done" : ""}">${esc(goal.title)} <span class="mono text-2">${done}/${total}</span></div>`;
    }).join("") + `<button class="chip-btn" data-goals-edit style="margin-top: var(--sp-8)">Цели</button>`;
}

const empty = text => `<p class="text-2">${text}</p>`;

// ---- утро ----
export function morning() {
    const todayKey = () => dayKey(new Date());
    flow([
        {
            title: "Вчера",
            body: () => {
                const yesterday = doneByDay(1).find(group => group.day === dayKey(addDays(new Date(), -1)))?.tasks.length || 0;
                const late = overdueTasks();
                return `<p class="lead">Вчера сделано: <b>${yesterday}</b>.${late.length ? " Хвосты — реши, куда их:" : ""}</p>` +
                    (late.map(task => row(task, [["today", "Сегодня"], ["tomorrow", "Завтра"], ["trash", "Удалить"]])).join("") || empty("Хвостов нет."));
            },
            click: act
        },
        {
            title: "Сегодня",
            body: () => {
                const day = load(todayKey());
                const inbox = inboxTasks().slice(0, 5);
                return loadBar(day) +
                    (day.tasks.filter(task => !task.done).map(task => row(task, [["tomorrow", "Завтра"]])).join("") || empty("На&nbsp;сегодня пока пусто.")) +
                    `<button class="chip-btn" data-add style="margin-top: var(--sp-12)">+ Задача</button>` +
                    (inbox.length ? `<div class="label">Из&nbsp;Входящих</div>` + inbox.map(task => row(task, [["today", "Сегодня"]])).join("") : "") +
                    `<div style="margin-top: var(--sp-16)">${goalsLine()}</div>`;
            },
            click: event => act(event) || extra(event)
        },
        {
            title: "Что подождёт",
            body: () => {
                const day = load(todayKey());
                if (day.over <= 0) {
                    return loadBar(day) + empty("Всё влезает — откладывать ничего не&nbsp;нужно.");
                }
                return loadBar(day) + `<p class="lead">Больше лимита на&nbsp;<b>${durationText(day.over)}</b>. Что подождёт?</p>` +
                    day.tasks.filter(task => !task.done).map(task => row(task, [["tomorrow", "Завтра"], ["inbox", "Входящие"]])).join("");
            },
            click: act
        },
        {
            title: "Зафиксировать",
            body: () => {
                const day = load(todayKey());
                const open = day.tasks.filter(task => !task.done).length;
                return `<p class="lead">План на&nbsp;сегодня: <b>${open}</b>${day.minutes ? `, это <b>${durationText(day.minutes)}</b>` : ""}. Отправь его в&nbsp;Напоминания, чтобы позвонили вовремя.</p>
                    <button class="btn ghost wide" data-send>Отправить в&nbsp;Напоминания</button>`;
            },
            click: extra
        }
    ], () => markRitual("morning"));
}

// ---- вечер ----
export function evening() {
    const todayKey = () => dayKey(new Date());
    flow([
        {
            title: "Что сделал",
            body: () => {
                const done = doneByDay(0).find(group => group.day === todayKey())?.tasks || [];
                const minutes = done.reduce((sum, task) => sum + (task.durationMin || 0), 0);
                return `<p class="lead">Сегодня сделано: <b>${done.length}</b>${minutes ? `, это <b>${durationText(minutes)}</b>` : ""}.</p>` +
                    (done.map(task => `<div class="goal-line done">${esc(task.title)}</div>`).join("") || empty("Ничего не&nbsp;отмечено — бывает. Завтра новый день."));
            }
        },
        {
            title: "Что переносим",
            body: () => {
                const open = [...load(todayKey()).tasks, ...overdueTasks().filter(task => dayOf(task.plannedAt) !== todayKey())]
                    .filter((task, i, all) => !task.done && all.indexOf(task) === i);
                return (open.length ? `<p class="lead">Не&nbsp;сделано: <b>${open.length}</b>.</p>
                    <button class="chip-btn" data-all-tomorrow style="margin-bottom: var(--sp-8)">Всё на&nbsp;завтра</button>` : "") +
                    (open.map(task => row(task, [["done", "Сделано"], ["tomorrow", "Завтра"], ["inbox", "Входящие"]])).join("") || empty("Всё закрыто. Красота."));
            },
            click: event => act(event) || extra(event)
        },
        {
            title: "Что завтра",
            body: () => {
                const day = load(dayKey(addDays(new Date(), 1)));
                return loadBar(day) +
                    (day.tasks.map(task => row(task, [["today", "Сегодня"], ["inbox", "Входящие"]], hasTime(task.plannedAt) ? timeText(task.plannedAt) : "в течение дня")).join("") || empty("На&nbsp;завтра пока пусто.")) +
                    `<button class="chip-btn" data-add style="margin-top: var(--sp-12)">+ Задача</button>`;
            },
            click: event => act(event) || extra(event)
        },
        {
            title: "На ночь",
            body: () => `<p class="lead">Выгрузи из&nbsp;головы, что крутится, и&nbsp;отправь завтрашний план в&nbsp;Напоминания.</p>
                <div class="card stack">
                    <button class="btn ghost wide" data-dump-now>Выгрузка из&nbsp;головы · ${state.settings.dumpMin}&nbsp;мин</button>
                    <button class="btn ghost wide" data-send>Отправить в&nbsp;Напоминания</button>
                </div>`,
            click: extra
        }
    ], () => markRitual("evening"));
}

// кнопки шагов, кроме действий со строками
function extra(event) {
    if (event.target.closest("[data-add]")) {
        quickAdd();
    } else if (event.target.closest("[data-goals-edit]")) {
        goalsSheet();
    } else if (event.target.closest("[data-send]")) {
        haptic();
        send();
    } else if (event.target.closest("[data-all-tomorrow]")) {
        haptic();
        const tomorrow = addDays(new Date(), 1);
        const open = [...load(dayKey(new Date())).tasks, ...overdueTasks()].filter((task, i, all) => !task.done && all.indexOf(task) === i);
        // шаг цепочки едет за своей главной задачей сам — иначе сдвинется дважды
        const ids = new Set(open.map(task => task.id));
        open.filter(task => !ids.has(task.chainOf)).forEach(task => moveTo(task, tomorrow));
        showToast(`На завтра: ${open.length}`);
    } else if (event.target.closest("[data-dump-now]")) {
        haptic();
        markRitual("evening");
        closeFlow();
        openDump(screen => document.querySelector(`.tab[data-screen="${screen}"]`)?.click());
    } else {
        return false;
    }
    return true;
}
