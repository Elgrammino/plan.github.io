// Таймер фокуса на задаче: на длительность задачи (или 25 минут), пауза, «+10 минут», «Готово».
// Состояние в базе: можно свернуть и закрыть приложение — время идёт дальше.
import { dayKey, durationText } from "./dates.js";
import { saveFocus, setDone, state } from "./store.js";
import { esc, haptic, ICONS, lockScroll, showToast, unlockScroll } from "./ui.js";

const DEFAULT_MIN = 25;

let root = null;
let tick = null;
let wakeLock = null;

// сколько уже сосредоточенно прошло, без пауз
function elapsedMs(focus, now = Date.now()) {
    return now - focus.startedAt - focus.pausedMs - (focus.pausedAt ? now - focus.pausedAt : 0);
}

function leftMs(focus) {
    return focus.plannedMin * 60000 - elapsedMs(focus);
}

const clock = ms => {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export function startFocus(task) {
    haptic();
    if (state.focus && state.focus.taskId !== task.id) {
        finish(false); // прошлый фокус засчитываем и закрываем
    }
    if (!state.focus) {
        state.focus = { taskId: task.id, startedAt: Date.now(), plannedMin: task.durationMin || DEFAULT_MIN, pausedAt: null, pausedMs: 0 };
        saveFocus();
    }
    openFocus();
}

// чип на «Сегодня», пока фокус свёрнут
export function focusChip() {
    const focus = state.focus;
    const task = focus && state.tasks.get(focus.taskId);
    if (!task || root) {
        return "";
    }
    return `<button class="chip-btn today-tool focus-chip" data-focus-open>Фокус · <span class="mono">${focus.pausedAt ? "пауза" : clock(leftMs(focus))}</span></button>`;
}

export function openFocus() {
    const focus = state.focus;
    const task = focus && state.tasks.get(focus.taskId);
    if (!task) {
        state.focus = null;
        saveFocus();
        return;
    }
    if (!root) {
        root = document.createElement("div");
        root.className = "dump focus";
        root.setAttribute("role", "dialog");
        document.body.append(root);
        lockScroll();
        root.addEventListener("click", onClick);
    }
    root.innerHTML = `
        <div class="dump-top">
            <button class="icon-btn" data-focus="hide" aria-label="Свернуть">${ICONS.close}</button>
            <span class="dump-count">Фокус</span>
            <span style="width: var(--tap)"></span>
        </div>
        <div class="focus-body">
            <div class="focus-task">${esc(task.title)}</div>
            <div class="focus-clock mono" id="focusClock"></div>
            <div class="bar"><i id="focusBar"></i></div>
            <div class="focus-note" id="focusNote"></div>
            ${task.checklist.length ? `<div class="focus-steps">${task.checklist.map(step => `<div class="${step.done ? "done" : ""}">${esc(step.text)}</div>`).join("")}</div>` : ""}
        </div>
        <div class="focus-actions">
            <button class="btn ghost" data-focus="pause" id="pauseBtn"></button>
            <button class="btn ghost" data-focus="more">+10 минут</button>
            <button class="btn primary wide" data-focus="done">Готово</button>
            <button class="btn ghost wide" data-focus="stop">Остановить</button>
        </div>`;
    update();
    clearInterval(tick);
    tick = setInterval(update, 1000);
    navigator.wakeLock?.request("screen").then(lock => wakeLock = lock).catch(() => { });
}

function update() {
    const focus = state.focus;
    if (!focus || !root) {
        return;
    }
    const left = leftMs(focus);
    const over = left <= 0;
    root.querySelector("#focusClock").textContent = over ? "+" + clock(-left) : clock(left);
    root.querySelector("#focusClock").classList.toggle("over", over);
    root.querySelector("#focusBar").style.width = Math.min(100, elapsedMs(focus) / (focus.plannedMin * 60000) * 100) + "%";
    root.querySelector("#focusNote").textContent = focus.pausedAt ? "Пауза" : over ? "Время вышло. Ещё 10 минут или готово?" : `из ${durationText(focus.plannedMin)}`;
    root.querySelector("#pauseBtn").textContent = focus.pausedAt ? "Продолжить" : "Пауза";
}

function close() {
    clearInterval(tick);
    wakeLock?.release().catch(() => { });
    wakeLock = null;
    root?.remove();
    root = null;
    unlockScroll();
}

// засчитать сосредоточенные минуты; done — отметить задачу
function finish(done) {
    const focus = state.focus;
    const task = state.tasks.get(focus.taskId);
    const minutes = Math.round(elapsedMs(focus) / 60000);
    if (minutes > 0) {
        state.focusLog.push({ taskId: focus.taskId, day: dayKey(new Date()), minutes });
    }
    state.focus = null;
    saveFocus();
    if (done && task && !task.done) {
        setDone(task, true);
    }
    return minutes;
}

function onClick(event) {
    const action = event.target.closest("[data-focus]")?.dataset.focus;
    const focus = state.focus;
    if (!action || !focus) {
        return;
    }
    haptic();
    if (action === "hide") {
        close();
        saveFocus(); // перерисовать «Сегодня» с чипом
    } else if (action === "pause") {
        if (focus.pausedAt) {
            focus.pausedMs += Date.now() - focus.pausedAt;
            focus.pausedAt = null;
        } else {
            focus.pausedAt = Date.now();
        }
        saveFocus();
        update();
    } else if (action === "more") {
        // «ещё 10 минут» считается от того, что осталось; если время вышло — от текущего момента
        focus.plannedMin = Math.ceil(Math.max(elapsedMs(focus), focus.plannedMin * 60000) / 60000) + 10;
        saveFocus();
        update();
    } else {
        const minutes = finish(action === "done");
        close();
        showToast(action === "done" ? `Готово. Фокус ${durationText(minutes) || "меньше минуты"}` : `Фокус: ${durationText(minutes) || "меньше минуты"}`);
    }
}
