// Обучение «показываю пальцем»: шаг делится на касания. Экран вокруг нужной кнопки затемняется,
// подсветка перелетает к следующей цели, рядом пузырь «Нажми сюда: так мы…». Плашка сама уезжает
// от цели наверх или вниз; при открытой шторке сжимается в строку над ней или прячется.
// Приложение само переводит на нужную вкладку. По пути собирается настоящий план; в конце — «План готов».
import { getMeta, setMeta } from "./db.js";
import { addDays, atTime, dayKey, durationText, hasTime, toIso } from "./dates.js";
import { openDump } from "./dump.js";
import { goalsSheet, weekGoals } from "./goals.js";
import { guideSheet, send } from "./notify.js";
import { lastSentAt } from "./reminders.js";
import { hideAllHints } from "./onboarding.js";
import { evening, morning } from "./rituals.js";
import { editTask } from "./sheets.js";
import { dayTasks, inboxTasks, newTask, onChange, saveTask, state } from "./store.js";
import { esc, haptic, ICONS, lockScroll, unlockScroll } from "./ui.js";

const today = () => dayKey(new Date());
const after = (iso, since) => !!iso && iso >= since;
const tasks = () => [...state.tasks.values()].filter(task => !task.deletedAt);

// moves — касания внутри шага: target — что подсветить, say — что сказать. Активно последнее касание,
// чья цель сейчас на экране: открыл шторку — подсказка переходит внутрь, закрыл — возвращается.
// screen — вкладка, на которую шаг переводит сам; action — кнопка на плашке, когда подсвечивать нечего.
// check — шаг сделан (по данным); click — шаг засчитывается нажатием на этот элемент.
const STEPS = [
    {
        id: "dump", part: "Собрать всё из головы", title: "Выгрузка из головы", screen: "today",
        text: "5 минут пишешь всё, что крутится в голове. Потом раскладываешь: вправо — в план, влево — удалить.",
        moves: [{ target: "#today [data-dump]", say: "Нажми сюда: так мы вытащим из головы всё, что там крутится." }],
        action: ["Начать", () => openDump(screen => document.querySelector(`.tab[data-screen="${screen}"]`)?.click())],
        check: () => state.lastDumpDay === today()
    },
    {
        id: "quick", part: "Собрать всё из головы", title: "Быстрый ввод", screen: "today",
        text: "Любое дело добавляется одной фразой.",
        moves: [
            { target: "#fab", say: "Нажми «+»: так добавляется любое дело." },
            { target: ".sheet #quickText", say: "Напиши «завтра в 10 позвонить заказчику 15 мин» и нажми «Добавить». День, время и длительность План поймёт сам." }
        ],
        check: (snap, since) => tasks().some(task => after(task.createdAt, since) && hasTime(task.plannedAt))
    },
    {
        id: "repeat", part: "Собрать всё из головы", title: "Повтор", screen: "today",
        text: "Повторы План тоже понимает со слов.",
        moves: [
            { target: "#fab", say: "Ещё раз «+»." },
            { target: ".sheet #quickText", say: "Напиши «зарядка каждый день в 8» и нажми «Добавить». Можно «по вторникам» или «1-го числа каждого месяца»." }
        ],
        check: (snap, since) => tasks().some(task => after(task.createdAt, since) && task.repeat)
    },
    {
        id: "inbox", part: "Разложить по дням", title: "Входящие", screen: "inbox",
        text: "Здесь всё, что без дня. Если пусто — шаг засчитается сам.",
        moves: [{ target: '#inbox .item .side [data-action="today"]', say: "Нажми «Сегодня»: задача встанет в план на сегодня. «Завтра» — на завтра." }],
        snap: () => ({ ids: inboxTasks().map(task => task.id) }),
        // пустые Входящие — шаг сам засчитывается
        check: snap => !snap.ids.length || snap.ids.some(id => state.tasks.get(id)?.plannedAt)
    },
    {
        id: "card", part: "Разложить по дням", title: "Карточка задачи", screen: "today",
        text: "У каждой задачи есть карточка: длительность, энергия, шаги, дедлайн.",
        moves: [
            { target: "#today .item .body", say: "Коснись задачи: откроется её карточка." },
            { target: "#today .focus-card-title", say: "Коснись названия задачи: откроется её карточка." },
            { target: '.sheet .field:has(input[name="duration"])', say: "Выбери, сколько займёт: так План знает, хватит ли дня. Редкое — энергия, сроки — в «Ещё параметры» ниже." }
        ],
        check: (snap, since) => tasks().some(task => after(task.updatedAt, since) && task.durationMin)
    },
    {
        id: "done", part: "Жить по плану", title: "Отметить сделанное", screen: "today",
        text: "Сделанное отмечается одним касанием.",
        moves: [
            { target: "#today .item:not(.done) .check", say: "Нажми кружок: задача сделана. Или смахни строку вправо." },
            { target: '#today .focus-card [data-action="toggle"]', say: "Нажми «Готово»: задача сделана. В списке ниже то же самое — кружок или смахнуть строку вправо." }
        ],
        check: (snap, since) => tasks().some(task => after(task.doneAt, since))
    },
    {
        id: "later", part: "Жить по плану", title: "Перенести", screen: "today",
        text: "Не успеваешь — переносишь. Это нормально, а не провал.",
        moves: [
            { target: "#today .item:not(.done)", say: "Смахни эту строку влево: откроется перенос." },
            { target: '#today .focus-card [data-action="postpone"]', say: "Нажми «Перенести». В списке ниже то же самое — смахнуть строку влево." },
            { target: ".sheet .actions", say: "Выбери «+1 час» или «Завтра утром»." }
        ],
        snap: () => ({ planned: Object.fromEntries(tasks().filter(task => task.plannedAt && !task.done).map(task => [task.id, task.plannedAt])) }),
        check: snap => Object.entries(snap.planned).some(([id, planned]) => {
            const task = state.tasks.get(id);
            return task && task.plannedAt !== planned;
        })
    },
    {
        id: "focus", part: "Жить по плану", title: "Фокус", screen: "today",
        text: "Открой любую задачу и нажми часики внизу карточки: пойдёт таймер.",
        moves: [
            { target: '#today [data-action="start"]', say: "Нажми «Приступить»: 40 минут работы, потом 5 минут отдыха." },
            { target: ".sheet #focus", say: "Нажми часики: пойдёт таймер фокуса." }
        ],
        snap: () => ({ log: state.focusLog.length }),
        check: snap => !!state.focus || state.focusLog.length > snap.log
    },
    {
        id: "calendar", part: "Видеть неделю", title: "Календарь", screen: "calendar",
        text: "Календарь: день по часам, неделя и месяц.",
        moves: [{ target: '#calendar [data-mode="week"]', say: "Нажми «Неделя»: видно, какой день перегружен." }],
        click: "[data-mode], [data-open-day]"
    },
    {
        id: "chain", part: "Большие дела", title: "Цепочка", screen: "today",
        text: "Большое дело тянет за собой маленькие: сборы, выезд, «после». Цепочка ставит их сама. Создадим пример — потом его можно удалить.",
        action: ["Создать пример", chainExample],
        moves: [
            { target: ".sheet .more-params:not([open]) > summary", say: "Открой «Ещё параметры»: цепочка там." },
            { target: '.sheet #chain [data-chain="chain-show"], .sheet #chain [data-chain]:last-child', say: "Это «Цепочка». Нажми «+ Выступление»: План сам добавит сборы, выезд и «после»." },
            { target: ".sheet #chainApply", say: "Проверь шаги и нажми «Создать»." }
        ],
        check: (snap, since) => tasks().some(task => task.chainOf && after(task.createdAt, since))
    },
    {
        id: "content", part: "Большие дела", title: "Контент", screen: "content",
        text: "Публикации по стадиям: идея, сценарий, снято, смонтировано, вышло.",
        moves: [{ target: '#content [data-view="calendar"]', say: "Нажми «Календарь»: видно, когда что выходит." }],
        click: "[data-view]"
    },
    {
        id: "goals", part: "Неделя", title: "Цели недели", screen: "today",
        text: "1–3 цели на неделю. Задачи привязываются к цели в карточке.",
        action: ["Открыть цели", () => goalsSheet()],
        moves: [
            { target: "#today [data-goals]", say: "Нажми «Цели недели»." },
            { target: ".sheet #newGoal", say: "Впиши цель, например «снять 3 рилса», и нажми «Добавить»." }
        ],
        check: () => weekGoals().length > 0
    },
    {
        id: "habit", part: "Неделя", title: "Привычка", screen: "more",
        text: "Привычка отмечается полоской на «Сегодня».",
        moves: [
            { target: '#more [data-tool="habits"]', say: "Нажми «Привычки»." },
            { target: ".sheet #newHabit", say: "Нажми «Новая привычка» и назови её." }
        ],
        check: () => state.habits.length > 0
    },
    {
        id: "matrix", part: "Неделя", title: "Матрица", screen: "more",
        text: "Что важно, а что просто срочно.",
        moves: [{ target: '#more [data-tool="matrix"]', say: "Нажми «Матрица»: задачи раскладываются на важное и срочное." }],
        click: '[data-tool="matrix"]'
    },
    {
        id: "claude", part: "Помощники", title: "Claude", screen: "more",
        text: "Claude может собрать тебе план, а План его импортирует.",
        moves: [{ target: '#more [data-more="format"]', say: "Нажми: формат скопируется. Вставь его в чат с Claude — он соберёт план." }],
        click: '[data-more="format"], [data-more="copy"]'
    },
    {
        id: "reminders", part: "Помощники", title: "Напоминания", screen: "more",
        text: "Чтобы телефон звонил вовремя, нужны Быстрые команды. Отправил — иди дальше: когда тест придёт, План спросит.",
        action: ["Открыть мастер", () => guideSheet()],
        moves: [{ target: '#more [data-notify="guide"]', say: "Нажми: мастер покажет, как собрать Быстрые команды. Потом «Тест» — когда придёт, План спросит." }],
        // засчитываем сразу после отправки: ждать звонка, стоя на шаге, не нужно
        check: () => state.remindersOk === true || !!state.testReminderAt || !!lastSentAt()
    },
    {
        id: "ritual", part: "Ритм", title: "Ритуал",
        text: "Утром — разбор дня, вечером — закрыть день. Пройди его сейчас: так план станет планом.",
        action: ["Начать", () => new Date().getHours() < 15 ? morning() : evening()],
        check: () => state.rituals.morning === today() || state.rituals.evening === today()
    }
];

// пример для цепочки: выступление завтра в 19:00 на 2 часа, сразу в карточке
function chainExample() {
    const task = newTask({ kind: "show", title: "Корпоратив (пример)", plannedAt: toIso(atTime(addDays(new Date(), 1), 19)), durationMin: 120 });
    saveTask(task);
    editTask(task);
}

let progress = null; // { index, since, snap, hidden, finished }
let card = null;
let spot = null;

export async function loadTutorial() {
    progress = (await getMeta("tutorial")) || null;
    state.remindersOk = await getMeta("remindersOk");
    state.testReminderAt = await getMeta("testReminderAt");
    if (progress && !progress.finished && !progress.hidden) {
        render();
    }
}

const save = () => setMeta("tutorial", progress);

export function startTutorial() {
    hideAllHints();
    progress = { index: 0, hidden: false, finished: false };
    beginStep();
}

function beginStep() {
    const step = STEPS[progress.index];
    progress.since = localMinute();
    progress.snap = step.snap ? step.snap() : {};
    save();
    goToScreen(step);
    render();
}

// шаг сам открывает свою вкладку — если сейчас не открыто окно поверх
function goToScreen(step) {
    if (step.screen && !overlay()) {
        document.querySelector(`.tab[data-screen="${step.screen}"]:not([aria-current])`)?.click();
    }
}

// время в задачах — до минуты и с поясом («2026-10-19T14:05:00+03:00»), поэтому начало шага — тоже минута:
// строка «2026-10-19T14:05» меньше любой отметки этой минуты и позже
function localMinute() {
    const date = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// чип на «Сегодня», пока обучение свёрнуто
export function tutorialChip() {
    if (!progress || progress.finished || !progress.hidden) {
        return "";
    }
    return `<button class="chip-btn today-tool tutorial-chip" data-tutorial-open>Обучение · <span class="mono">${progress.index + 1}/${STEPS.length}</span></button>`;
}

export function resumeTutorial() {
    if (!progress || progress.finished) {
        startTutorial();
        return;
    }
    progress.hidden = false;
    save();
    goToScreen(STEPS[progress.index]);
    render();
}

// ---- плашка и подсветка ----
const active = () => progress && !progress.finished && !progress.hidden;

// верхнее открытое окно: шторка или полноэкранный экран (выгрузка, фокус, матрица)
function overlay() {
    const open = [...document.querySelectorAll(".sheet:not(.leaving):not(.dismiss), .dump")];
    return open[open.length - 1] || null;
}

// цель видна и не закрыта окном поверх
function reachable(element, top) {
    return element && element.getClientRects().length && (!top || top.contains(element));
}

// какое касание сейчас: последнее, чья цель на экране
function currentMove(step) {
    const top = overlay();
    for (let i = (step.moves || []).length - 1; i >= 0; i--) {
        // первая видимая: строка в свёрнутом «Просрочено» есть в документе, но пальцу недоступна
        const element = [...document.querySelectorAll(step.moves[i].target)].find(item => reachable(item, top));
        if (element) {
            return { move: step.moves[i], element, index: i };
        }
    }
    return null;
}

let shown = { step: -1, move: -2, mode: "" };

function render() {
    if (!active()) {
        card?.remove();
        spot?.remove();
        card = spot = null;
        shown = { step: -1, move: -2, mode: "" };
        return;
    }
    if (!card) {
        card = document.createElement("div");
        card.className = "coach";
        card.setAttribute("role", "status");
        document.body.append(card);
        card.addEventListener("click", onCardClick);
        spot = document.createElement("div");
        spot.className = "coach-spot";
        spot.hidden = true;
        document.body.append(spot);
    }
    const step = STEPS[progress.index];
    const found = currentMove(step);
    const top = overlay();
    // окно поверх и цели в нём нет — не мешаем: плашка и подсветка прячутся
    const mode = top && !found ? "away" : top ? "compact" : "full";
    const moveIndex = found ? found.index : -1;
    if (shown.step !== progress.index || shown.move !== moveIndex || shown.mode !== mode) {
        const fresh = shown.step !== progress.index;
        shown = { step: progress.index, move: moveIndex, mode };
        const say = found ? found.move.say : step.text;
        card.innerHTML = mode === "compact" ? `
            <div class="coach-compact">
                <span class="coach-say">${esc(say)}</span>
                <button class="icon-btn" data-coach="hide" aria-label="Свернуть обучение">${ICONS.close}</button>
            </div>` : `
            <div class="coach-head">
                <span class="coach-part">${esc(step.part)} · <span class="mono">${progress.index + 1}/${STEPS.length}</span></span>
                <button class="icon-btn" data-coach="hide" aria-label="Свернуть">${ICONS.close}</button>
            </div>
            <div class="coach-bar"><i style="transform: scaleX(${progress.index / STEPS.length})"></i></div>
            <div class="coach-title">${esc(step.title)}</div>
            <div class="coach-text">${esc(say)}</div>
            <div class="coach-btns">
                ${step.action && !found ? `<button class="btn primary" data-coach="action">${esc(step.action[0])}</button>` : ""}
                <button class="btn ghost quiet" data-coach="skip">Пропустить</button>
            </div>`;
        card.classList.toggle("compact", mode === "compact");
        card.classList.toggle("away", mode === "away");
        if (fresh) {
            card.classList.remove("coach-enter");
            void card.offsetWidth;
            card.classList.add("coach-enter");
        }
        // новая цель — прокручиваем к ней, чтобы палец её видел
        found?.element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    place(found, mode);
}

// подсветка — на цель, плашка — на другую половину экрана, чтобы не закрывать то, что нажимать
let spotTarget = null;
let spotTimer = 0;

function place(found, mode) {
    if (!found || mode === "away") {
        spot.hidden = true;
        spotTarget = null;
    } else {
        const rect = found.element.getBoundingClientRect();
        const pad = 6;
        // перелёт только к новой цели (и не из скрытого состояния); прокрутка и подстройка — мгновенно
        if (found.element !== spotTarget) {
            spot.classList.toggle("moving", !spot.hidden && !!spotTarget);
            clearTimeout(spotTimer);
            spotTimer = setTimeout(() => spot.classList.remove("moving"), 380);
            spotTarget = found.element;
        }
        spot.hidden = false;
        // в шторке рядом с целью есть и «Добавить», и «Закрыть» — их не гасим, только приглушаем
        spot.classList.toggle("soft", mode === "compact");
        spot.style.width = rect.width + pad * 2 + "px";
        spot.style.height = rect.height + pad * 2 + "px";
        spot.style.transform = `translate(${rect.left - pad}px, ${rect.top - pad}px)`;
    }
    if (mode === "away") {
        return;
    }
    const rect = found?.element.getBoundingClientRect();
    const low = rect && rect.top + rect.height / 2 > window.innerHeight * 0.45;
    const up = mode === "compact" || low;
    // низ: над кнопкой «+» и панелью вкладок; верх: под строкой состояния
    const fab = document.getElementById("fab");
    const floor = (fab && !fab.hidden ? fab.getBoundingClientRect().top : document.querySelector(".tabbar")?.getBoundingClientRect().top ?? window.innerHeight) - 12;
    const y = up ? 0 : Math.max(0, floor - card.offsetHeight - card.offsetTop);
    card.style.transform = `translateY(${y}px)`;
}

// пока обучение на экране — следим за целями: перелёт подсветки, смена касания, шаг засчитан
let frame = 0;
const schedule = () => {
    if (active() && !frame) {
        frame = requestAnimationFrame(() => {
            frame = 0;
            render();
        });
    }
};
setInterval(() => active() && (check(), schedule()), 400);
window.addEventListener("scroll", schedule, { capture: true, passive: true });
window.addEventListener("resize", schedule);

function onCardClick(event) {
    const what = event.target.closest("[data-coach]")?.dataset.coach;
    if (!what) {
        return;
    }
    haptic();
    const step = STEPS[progress.index];
    if (what === "hide") {
        progress.hidden = true;
        save();
        render();
        // перерисовать «Сегодня» с чипом «Обучение»
        document.querySelector(".tab[aria-current]")?.click();
    } else if (what === "skip") {
        next(false);
    } else if (what === "action") {
        step.action[1]();
    }
}

function next(succeeded) {
    if (succeeded && card) {
        card.classList.add("coach-ok");
        spot && (spot.hidden = true);
    }
    setTimeout(() => {
        card?.classList.remove("coach-ok");
        progress.index++;
        if (progress.index >= STEPS.length) {
            progress.finished = true;
            save();
            render();
            finale();
        } else {
            beginStep();
        }
    }, succeeded ? 900 : 0);
}

// ---- проверка шагов ----
let checking = false;

function check() {
    if (!progress || progress.finished || checking) {
        return;
    }
    const step = STEPS[progress.index];
    if (step.check && step.check(progress.snap || {}, progress.since)) {
        checking = true;
        next(true);
        setTimeout(() => checking = false, 1000);
    }
}

onChange(() => setTimeout(check, 50));
// вернулся из Быстрых команд после отправки — шаг «Напоминания» засчитывается без лишних касаний
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && setTimeout(check, 300));

// шаги «загляни туда»: засчитываются нажатием
document.addEventListener("click", event => {
    const step = progress && !progress.finished && STEPS[progress.index];
    if (step?.click && event.target.closest(step.click) && !checking) {
        checking = true;
        setTimeout(() => {
            next(true);
            checking = false;
        }, 600);
    }
}, true);

// ---- финал: план готов ----
function finale() {
    const now = new Date();
    const count = key => {
        const { timed, anytime } = dayTasks(key);
        return [...timed, ...anytime].filter(task => !task.done);
    };
    const todayList = count(dayKey(now));
    const tomorrowList = count(dayKey(addDays(now, 1)));
    let week = 0;
    for (let i = 0; i < 7; i++) {
        week += count(dayKey(addDays(now, i))).length;
    }
    const minutes = todayList.reduce((sum, task) => sum + (task.durationMin || 0), 0);
    const goals = weekGoals();

    const root = document.createElement("div");
    root.className = "dump onboarding";
    root.setAttribute("role", "dialog");
    root.innerHTML = `
        <div class="dump-top"><span></span><span class="dump-count">Обучение пройдено</span><span style="width: var(--tap)"></span></div>
        <div class="onboarding-body enter">
            <h1 class="title">План готов</h1>
            <p class="lead">Сегодня <b>${todayList.length}</b>${minutes ? ` (${durationText(minutes)})` : ""}, завтра <b>${tomorrowList.length}</b>, на&nbsp;неделе <b>${week}</b>${goals.length ? `, целей недели <b>${goals.length}</b>` : ""}${state.habits.length ? `, привычек <b>${state.habits.length}</b>` : ""}.</p>
            <div class="card stack routine">
                <div><b>Утро</b> — придёт напоминание: «Разобрать» на&nbsp;«Сегодня», 5 минут.</div>
                <div><b>День</b> — смотри только блок «Сейчас». Сделал — смахни вправо, не&nbsp;успеваешь — влево. Сложное — с&nbsp;часиками фокуса.</div>
                <div><b>Новое</b> — сразу в&nbsp;«+» одной фразой или Siri «Добавь в&nbsp;план». Разложишь вечером.</div>
                <div><b>Вечер</b> — «Закрыть день»: что сделал, что переносим, что завтра, выгрузка из&nbsp;головы.</div>
                <div><b>Неделя</b> — в&nbsp;понедельник цели недели, в&nbsp;воскресенье бэкап.</div>
            </div>
        </div>
        <div class="btns onboarding-foot">
            <button class="btn ghost" data-final="send">В&nbsp;Напоминания</button>
            <button class="btn primary" data-final="go">К&nbsp;плану</button>
        </div>`;
    document.body.append(root);
    lockScroll();
    root.addEventListener("click", event => {
        const what = event.target.closest("[data-final]")?.dataset.final;
        if (what === "send") {
            haptic();
            send();
        } else if (what === "go") {
            haptic();
            root.remove();
            unlockScroll();
            document.querySelector('.tab[data-screen="today"]')?.click();
        }
    });
}
