// Матрица Эйзенхауэра: важно — priority "high", срочно — urgent (вручную) или по срокам.
// Задачу тянут за ручку в другой квадрат; касание по задаче открывает выбор квадрата.
import { addDays, dayKey, dayOf, hasTime, relativeDay, timeText } from "./dates.js";
import { editTask } from "./sheets.js";
import { isOverdue, onChange, saveTask, state } from "./store.js";
import { esc, haptic, ICONS, lockScroll, openSheet, unlockScroll } from "./ui.js";

const QUADRANTS = [
    { id: "do", important: true, urgent: true, title: "Сделать", hint: "важно и срочно" },
    { id: "plan", important: true, urgent: false, title: "Запланировать", hint: "важно, не срочно" },
    { id: "quick", important: false, urgent: true, title: "Быстро или отдать", hint: "срочно, не важно" },
    { id: "drop", important: false, urgent: false, title: "Убрать", hint: "не важно, не срочно" }
];

const GRIP = `<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>`;

// срочно по срокам: просрочено, дедлайн в ближайшие 2 дня или в плане на сегодня-завтра
function isUrgent(task, now = new Date()) {
    if (task.urgent !== null && task.urgent !== undefined) {
        return task.urgent;
    }
    const soon = dayKey(addDays(now, 2));
    const tomorrow = dayKey(addDays(now, 1));
    return isOverdue(task, now) || (!!task.due && dayOf(task.due) <= soon) || (!!task.plannedAt && dayOf(task.plannedAt) <= tomorrow);
}

const quadrantOf = task => QUADRANTS.find(q => q.important === (task.priority === "high") && q.urgent === isUrgent(task));

// открытые задачи на ближайшие две недели и Входящие; публикации живут в «Контенте»
function tasks(now = new Date()) {
    const until = dayKey(addDays(now, 14));
    return [...state.tasks.values()].filter(task => !task.done && !task.deletedAt && task.kind !== "post"
        && (!task.plannedAt || dayOf(task.plannedAt) <= until))
        .sort((a, b) => (a.plannedAt || "9").localeCompare(b.plannedAt || "9"));
}

function move(task, quadrant) {
    task.priority = quadrant.important ? "high" : "normal";
    task.urgent = quadrant.urgent;
    return saveTask(task);
}

let root = null;
let unsubscribe = () => { };

export function openMatrix() {
    root = document.createElement("div");
    root.className = "dump matrix-screen";
    root.setAttribute("role", "dialog");
    document.body.append(root);
    lockScroll();
    root.addEventListener("click", onClick);
    root.addEventListener("pointerdown", onGrip);
    unsubscribe = onChange(render);
    render();
}

function close() {
    unsubscribe();
    root.remove();
    root = null;
    unlockScroll();
}

function render() {
    if (!root) {
        return;
    }
    const all = tasks();
    root.innerHTML = `
        <div class="dump-top">
            <button class="icon-btn" data-close-matrix aria-label="Закрыть">${ICONS.close}</button>
            <span class="dump-count">Матрица</span>
            <span style="width: var(--tap)"></span>
        </div>
        <p class="hint">Тяни задачу за&nbsp;ручку в&nbsp;другой квадрат или коснись её. Срочность сама считается по&nbsp;срокам, пока не&nbsp;передвинешь вручную.</p>
        <div class="matrix">${QUADRANTS.map(q => {
            const list = all.filter(task => quadrantOf(task) === q);
            return `
                <section class="quadrant q-${q.id}" data-quadrant="${q.id}">
                    <div class="q-head"><b>${q.title}</b><span class="mono">${list.length}</span></div>
                    <div class="q-hint">${q.hint}</div>
                    ${list.map(task => `
                        <div class="m-task" data-id="${task.id}">
                            <button class="m-body" data-pick-task="${task.id}">
                                <span class="m-title">${esc(task.title)}</span>
                                <span class="m-sub">${esc(task.plannedAt ? relativeDay(task.plannedAt) + (hasTime(task.plannedAt) ? " " + timeText(task.plannedAt) : "") : "без дня")}${task.due ? " · до " + esc(relativeDay(task.due)) : ""}</span>
                            </button>
                            <span class="grip" data-grip="${task.id}" aria-label="Перетащить">${GRIP}</span>
                        </div>`).join("")}
                </section>`;
        }).join("")}</div>`;
}

function onClick(event) {
    if (event.target.closest("[data-close-matrix]")) {
        close();
        return;
    }
    const id = event.target.closest("[data-pick-task]")?.dataset.pickTask;
    const task = id && state.tasks.get(id);
    if (!task) {
        return;
    }
    // выбор квадрата касанием — на случай, если тянуть неудобно
    const current = quadrantOf(task);
    const { sheet, close: closeSheet } = openSheet(`
        <div class="sheet-body">
            <h2>${esc(task.title)}</h2>
            <div class="actions">${QUADRANTS.map(q => `
                <button class="btn ${q === current ? "primary" : "ghost"} wide" data-to="${q.id}">${q.title}<span class="text-2" style="font-weight: 400">${q.hint}</span></button>`).join("")}
                <button class="btn ghost wide" data-auto>Срочность по&nbsp;срокам</button>
            </div>
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" data-edit>Открыть задачу</button>
            <button class="btn primary grow" data-close>Готово</button>
        </div>`);
    sheet.addEventListener("click", clicked => {
        const to = QUADRANTS.find(q => q.id === clicked.target.closest("[data-to]")?.dataset.to);
        if (to) {
            haptic();
            move(task, to);
            closeSheet();
        } else if (clicked.target.closest("[data-auto]")) {
            task.urgent = null;
            saveTask(task);
            closeSheet();
        } else if (clicked.target.closest("[data-edit]")) {
            closeSheet();
            editTask(task);
        } else if (clicked.target.closest("[data-close]")) {
            closeSheet();
        }
    });
}

// перетаскивание за ручку: копия едет за пальцем, квадрат под пальцем подсвечивается
function onGrip(event) {
    const grip = event.target.closest("[data-grip]");
    if (!grip) {
        return;
    }
    event.preventDefault();
    const task = state.tasks.get(grip.dataset.grip);
    const card = grip.closest(".m-task");
    const box = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add("m-ghost");
    Object.assign(ghost.style, { width: box.width + "px", left: box.left + "px", top: box.top + "px" });
    document.body.append(ghost);
    card.classList.add("m-dragging");
    const dx = event.clientX - box.left;
    const dy = event.clientY - box.top;
    let target = null;

    const moveTo = (x, y) => {
        ghost.style.left = x - dx + "px";
        ghost.style.top = y - dy + "px";
        ghost.hidden = true; // чтобы elementFromPoint видел квадрат под копией
        const under = document.elementFromPoint(x, y)?.closest("[data-quadrant]");
        ghost.hidden = false;
        if (under !== target) {
            target?.classList.remove("drop");
            target = under;
            target?.classList.add("drop");
        }
    };
    const onMove = moveEvent => moveTo(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        ghost.remove();
        card.classList.remove("m-dragging");
        target?.classList.remove("drop");
        const quadrant = QUADRANTS.find(q => q.id === target?.dataset.quadrant);
        if (quadrant && quadrant !== quadrantOf(task)) {
            haptic();
            move(task, quadrant);
        }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    moveTo(event.clientX, event.clientY);
}
