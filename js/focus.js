// Фокус циклами: «Приступить» — 40 минут работы, звонок, 5 минут перерыва, звонок, следующая задача.
// Состояние в базе: можно свернуть и закрыть приложение — время идёт дальше.
// Звонок: пока План на экране — звук и вибрация здесь; заблокирован телефон — таймер «Часов»
// через Быструю команду «План: таймер» (включается в мастере команд, раздел 6).
import { dayKey, durationText } from "./dates.js";
import { runShortcut, SHORTCUT_TIMER } from "./reminders.js";
import { currentTask, saveFocus, setDone, state } from "./store.js";
import { esc, escTitle, haptic, ICONS, lockScroll, showToast, unlockScroll } from "./ui.js";

let root = null;
let tick = null;
let wakeLock = null;

const workMin = () => state.settings.focusMin || 40;
const breakMin = () => state.settings.breakMin || 5;

// сколько уже прошло, без пауз
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

// ---- звук: AudioContext открывается нажатием «Приступить», иначе iOS не даст играть ----
let audio = null;
function unlockAudio() {
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        audio.resume();
    } catch (e) { }
}

function ring() {
    haptic();
    if (!audio || document.visibilityState !== "visible") {
        return;
    }
    // три серии по три коротких сигнала — слышно, но не сирена
    const start = audio.currentTime + 0.05;
    for (let series = 0; series < 3; series++) {
        for (let beep = 0; beep < 3; beep++) {
            const at = start + series * 1.2 + beep * 0.22;
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
            osc.connect(gain).connect(audio.destination);
            osc.start(at);
            osc.stop(at + 0.18);
        }
    }
}

// таймер «Часов»: звонит и на заблокированном телефоне (если команда включена)
function clockTimer(minutes) {
    if (state.settings.timerAlarm) {
        runShortcut(SHORTCUT_TIMER, String(minutes));
    }
}

// следующая задача после перерыва: несделанная — она же, сделанная — следующая по плану
function nextTask(focus) {
    const same = state.tasks.get(focus.taskId);
    if (same && !same.done && !same.deletedAt) {
        return same;
    }
    return currentTask(new Date())?.task || null;
}

// ---- начало работы ----
export function startWork(task) {
    haptic();
    unlockAudio();
    if (state.focus && state.focus.phase !== "break") {
        logWork(); // прошлый фокус засчитываем
    }
    state.focus = { phase: "work", taskId: task.id, startedAt: Date.now(), plannedMin: workMin(), pausedAt: null, pausedMs: 0, rang: false };
    saveFocus();
    openFocus();
    clockTimer(workMin());
}

// часики в карточке задачи и на «Сегодня»: тот же цикл
export const startFocus = startWork;

function startBreak(doneNote = "") {
    const focus = state.focus;
    state.focus = { phase: "break", taskId: focus.taskId, startedAt: Date.now(), plannedMin: breakMin(), pausedAt: null, pausedMs: 0, rang: false, doneNote };
    saveFocus();
    render();
    clockTimer(breakMin());
}

// чип на «Сегодня», пока фокус свёрнут
export function focusChip() {
    const focus = state.focus;
    if (!focus || root || !state.tasks.get(focus.taskId)) {
        return "";
    }
    const what = focus.phase === "break" ? "Перерыв" : "Фокус";
    const left = leftMs(focus);
    return `<button class="chip-btn today-tool focus-chip" data-focus-open>${what} · <span class="mono">${focus.pausedAt ? "пауза" : left > 0 ? clock(left) : "время вышло"}</span></button>`;
}

export function openFocus() {
    if (!state.focus || !state.tasks.get(state.focus.taskId)) {
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
    render();
    clearInterval(tick);
    tick = setInterval(update, 1000);
    navigator.wakeLock?.request("screen").then(lock => wakeLock = lock).catch(() => { });
}

// разметка под фазу: работа, работа кончилась, перерыв, перерыв кончился
function render() {
    const focus = state.focus;
    const task = state.tasks.get(focus.taskId);
    const over = leftMs(focus) <= 0;
    const next = nextTask(focus);
    const top = `
        <div class="dump-top">
            <button class="icon-btn" data-focus="hide" aria-label="Свернуть">${ICONS.close}</button>
            <span class="dump-count">${focus.phase === "break" ? "Перерыв" : "Фокус"}</span>
            <span style="width: var(--tap)"></span>
        </div>`;
    let body;
    let actions;
    if (focus.phase === "work") {
        body = `
            <div class="focus-task">${escTitle(task.title)}</div>
            <div class="focus-clock mono" id="focusClock"></div>
            <div class="bar"><i id="focusBar"></i></div>
            <div class="focus-note" id="focusNote"></div>
            ${task.checklist.length ? `<div class="focus-steps">${task.checklist.map(step => `<div class="${step.done ? "done" : ""}">${esc(step.text)}</div>`).join("")}</div>` : ""}`;
        actions = over ? `
            <button class="btn primary wide" data-focus="break">Перерыв ${breakMin()}&nbsp;минут</button>
            <button class="btn ghost" data-focus="done-break">Готово и&nbsp;перерыв</button>
            <button class="btn ghost" data-focus="more">+10 минут</button>
            <button class="btn ghost wide" data-focus="stop">Закончить</button>` : `
            <button class="btn ghost" data-focus="pause" id="pauseBtn"></button>
            <button class="btn ghost" data-focus="more">+10 минут</button>
            <button class="btn primary wide" data-focus="done-break">Готово</button>
            <button class="btn ghost wide" data-focus="stop">Остановить</button>`;
    } else {
        body = `
            ${focus.doneNote ? `<div class="focus-done">${esc(focus.doneNote)}</div>` : ""}
            <div class="focus-note">${over ? "Перерыв окончен" : "Отдохни: встань, подыши, налей воды"}</div>
            <div class="focus-clock mono" id="focusClock"></div>
            <div class="bar"><i id="focusBar"></i></div>
            ${next ? `<div class="focus-next">Дальше: <b>${escTitle(next.title)}</b></div>` : `<div class="focus-next">На сегодня задач со временем больше нет</div>`}`;
        actions = `
            ${next ? `<button class="btn primary wide" data-focus="next">${over ? "Приступить" : "Приступить сейчас"}</button>` : ""}
            <button class="btn ghost wide" data-focus="stop">${next ? "Закончить" : "Закрыть"}</button>`;
    }
    root.innerHTML = `${top}<div class="focus-body">${body}</div><div class="focus-actions">${actions}</div>`;
    root.dataset.phase = focus.phase;
    root.dataset.over = over ? "yes" : "";
    update();
}

function update() {
    const focus = state.focus;
    if (!focus || !root) {
        return;
    }
    const left = leftMs(focus);
    const over = left <= 0;
    // время вышло: звонок один раз (если вышло давно — без звука, просто показываем)
    if (over && !focus.rang) {
        focus.rang = true;
        saveFocus();
        if (-left < 60000) {
            ring();
        }
        render();
        return;
    }
    if (over !== (root.dataset.over === "yes")) {
        render();
        return;
    }
    const clockEl = root.querySelector("#focusClock");
    clockEl.textContent = over ? "+" + clock(-left) : clock(left);
    clockEl.classList.toggle("over", over);
    root.querySelector("#focusBar").style.width = Math.min(100, elapsedMs(focus) / (focus.plannedMin * 60000) * 100) + "%";
    const note = root.querySelector("#focusNote");
    if (note) {
        note.textContent = focus.pausedAt ? "Пауза" : over ? `${durationText(focus.plannedMin)} прошли. Перерыв?` : `из ${durationText(focus.plannedMin)}`;
    }
    const pause = root.querySelector("#pauseBtn");
    if (pause) {
        pause.textContent = focus.pausedAt ? "Продолжить" : "Пауза";
    }
}

// фоновая проверка: приложение открыто, фокус свёрнут — всё равно звоним вовремя
setInterval(() => {
    const focus = state.focus;
    if (focus && !root && !focus.rang && leftMs(focus) <= 0) {
        openFocus();
    }
}, 5000);

function close() {
    clearInterval(tick);
    wakeLock?.release().catch(() => { });
    wakeLock = null;
    root?.remove();
    root = null;
    unlockScroll();
}

// засчитать минуты работы в журнал фокуса
function logWork() {
    const focus = state.focus;
    if (!focus || focus.phase !== "work") {
        return 0;
    }
    const minutes = Math.round(elapsedMs(focus) / 60000);
    if (minutes > 0) {
        state.focusLog.push({ taskId: focus.taskId, day: dayKey(new Date()), minutes });
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
    unlockAudio();
    const task = state.tasks.get(focus.taskId);
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
        // «ещё 10 минут» — от того, что осталось; если время вышло — от текущего момента
        focus.plannedMin = Math.ceil(Math.max(elapsedMs(focus), focus.plannedMin * 60000) / 60000) + 10;
        focus.rang = false;
        saveFocus();
        render();
        clockTimer(Math.ceil(leftMs(focus) / 60000));
    } else if (action === "break" || action === "done-break") {
        const minutes = logWork();
        let note = "";
        // тост закрыл бы кнопки внизу — итог пишем на самом экране перерыва
        if (action === "done-break" && task && !task.done) {
            setDone(task, true);
            note = `Готово: ${task.title} · ${durationText(minutes) || "меньше минуты"} фокуса`;
        }
        startBreak(note);
    } else if (action === "next") {
        const next = nextTask(focus);
        if (next) {
            startWork(next);
        }
    } else if (action === "stop") {
        const minutes = logWork();
        state.focus = null;
        saveFocus();
        close();
        if (minutes) {
            showToast(`Фокус: ${durationText(minutes)}`);
        }
    }
}
