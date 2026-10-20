// Интерактивное обучение: карточка-тренер внизу экрана ведёт по всем функциям.
// Каждый шаг ты делаешь сам, приложение замечает результат и идёт дальше.
// По пути собирается настоящий план; в конце — «План готов» и памятка, как ему следовать.
import { getMeta, setMeta } from "./db.js";
import { addDays, dayKey, durationText, hasTime } from "./dates.js";
import { weekGoals } from "./goals.js";
import { guideSheet, send } from "./notify.js";
import { hideAllHints } from "./onboarding.js";
import { evening, morning } from "./rituals.js";
import { dayTasks, inboxTasks, onChange, state } from "./store.js";
import { ICONS, esc, haptic } from "./ui.js";

const today = () => dayKey(new Date());
const after = (iso, since) => !!iso && iso >= since;
const tasks = () => [...state.tasks.values()].filter(task => !task.deletedAt);

// show: вкладка и что подсветить; click: шаг засчитывается нажатием на этот элемент
const STEPS = [
    {
        id: "dump", part: "Собрать всё из головы", title: "Выгрузка из головы",
        text: "Нажми «Выгрузка из головы», 5 минут пиши всё, что крутится, потом разложи карточки: вправо — в план, влево — удалить.",
        show: ["today", "[data-dump]"],
        check: () => state.lastDumpDay === today()
    },
    {
        id: "quick", part: "Собрать всё из головы", title: "Быстрый ввод",
        text: "Нажми «+» и напиши одной фразой: «завтра в 10 позвонить заказчику 15 мин». Время, длительность и день разберутся сами.",
        show: ["today", "#fab"],
        check: (snap, since) => tasks().some(task => after(task.createdAt, since) && hasTime(task.plannedAt))
    },
    {
        id: "repeat", part: "Собрать всё из головы", title: "Повтор",
        text: "Ещё раз «+»: «зарядка каждый день в 8». Можно «по вторникам и четвергам», «1-го числа каждого месяца».",
        show: ["today", "#fab"],
        check: (snap, since) => tasks().some(task => after(task.createdAt, since) && task.repeat)
    },
    {
        id: "inbox", part: "Разложить по дням", title: "Входящие",
        text: "Открой «Входящие» — тут всё без дня. У задачи нажми «Сегодня» или открой её и поставь день.",
        show: ["inbox", "#inbox .side"],
        snap: () => ({ ids: inboxTasks().map(task => task.id) }),
        // пустые Входящие — шаг сам засчитывается
        check: snap => !snap.ids.length || snap.ids.some(id => state.tasks.get(id)?.plannedAt)
    },
    {
        id: "card", part: "Разложить по дням", title: "Карточка задачи",
        text: "Открой любую задачу касанием и поставь длительность и энергию. Там же шаги, дедлайн, повтор и «Настойчиво».",
        show: ["today", ".item .body"],
        check: (snap, since) => tasks().some(task => after(task.updatedAt, since) && task.energy && task.durationMin)
    },
    {
        id: "done", part: "Жить по плану", title: "Отметить сделанное",
        text: "Смахни задачу вправо или нажми кружок. Выполненное тихо растворяется и попадает в журнал.",
        show: ["today", ".item .check"],
        check: (snap, since) => tasks().some(task => after(task.doneAt, since))
    },
    {
        id: "later", part: "Жить по плану", title: "Перенести",
        text: "Смахни задачу влево и выбери «+1 час» или «Завтра утром». Перенос — это нормально, а не провал.",
        show: ["today", ".item"],
        snap: () => ({ planned: Object.fromEntries(tasks().filter(task => task.plannedAt && !task.done).map(task => [task.id, task.plannedAt])) }),
        check: snap => Object.entries(snap.planned).some(([id, planned]) => {
            const task = state.tasks.get(id);
            return task && task.plannedAt !== planned;
        })
    },
    {
        id: "focus", part: "Жить по плану", title: "Фокус",
        text: "В блоке «Сейчас» или в карточке задачи нажми часики. Таймер на длительность задачи, пауза и «+10 минут» — внизу.",
        show: ["today", "[data-action=focus]"],
        snap: () => ({ log: state.focusLog.length }),
        check: snap => !!state.focus || state.focusLog.length > snap.log
    },
    {
        id: "calendar", part: "Видеть неделю", title: "Календарь",
        text: "Открой «Календарь»: неделя с загрузкой по дням, касание по дню — сетка часов.",
        show: ["calendar", null],
        click: '.tab[data-screen="calendar"], [data-open-day], [data-mode]'
    },
    {
        id: "chain", part: "Большие дела", title: "Цепочка",
        text: "Создай выступление или публикацию со временем, открой её и в блоке «Цепочка» нажми «+ Выступление» или «+ Публикация». Сборы, выезд, съёмка посчитаются сами.",
        show: ["today", "#fab"],
        check: (snap, since) => tasks().some(task => task.chainOf && after(task.createdAt, since))
    },
    {
        id: "content", part: "Большие дела", title: "Контент",
        text: "Загляни в «Контент»: публикации по стадиям, календарь и сетка ленты. «+» там — новая идея.",
        show: ["content", null],
        click: '.tab[data-screen="content"], [data-view]'
    },
    {
        id: "goals", part: "Неделя", title: "Цели недели",
        text: "На «Сегодня» нажми «Цели недели» и поставь 1–3 цели. В карточке задачи её можно привязать к цели.",
        show: ["today", "[data-goals]"],
        check: () => weekGoals().length > 0
    },
    {
        id: "habit", part: "Неделя", title: "Привычка",
        text: "«Ещё» → «Привычки» → «Новая привычка». Отмечается полоской на «Сегодня».",
        show: ["more", '[data-tool="habits"]'],
        check: () => state.habits.length > 0
    },
    {
        id: "matrix", part: "Неделя", title: "Матрица",
        text: "«Ещё» → «Матрица Эйзенхауэра»: что важно, а что просто срочно. Тяни задачу за точки справа.",
        show: ["more", '[data-tool="matrix"]'],
        click: '[data-tool="matrix"]'
    },
    {
        id: "claude", part: "Помощники", title: "Claude",
        text: "«Ещё» → «Скопировать формат для Claude» и вставь в чат с Claude: он соберёт план, который приложение импортирует.",
        show: ["more", '[data-more="format"]'],
        click: '[data-more="format"], [data-more="copy"]'
    },
    {
        id: "reminders", part: "Помощники", title: "Напоминания",
        text: "Чтобы телефон звонил вовремя, собери Быстрые команды по мастеру и сделай тест. Можно и позже — «Пропустить».",
        action: ["Открыть мастер", () => guideSheet()],
        check: () => state.remindersOk === true
    },
    {
        id: "ritual", part: "Ритм", title: "Ритуал",
        text: "Утром — разбор дня, вечером — закрыть день. Пройди его сейчас: так план станет планом.",
        action: ["Начать", () => new Date().getHours() < 15 ? morning() : evening()],
        check: () => state.rituals.morning === today() || state.rituals.evening === today()
    }
];

let progress = null; // { index, since, snap, hidden, finished }
let card = null;

export async function loadTutorial() {
    progress = (await getMeta("tutorial")) || null;
    state.remindersOk = await getMeta("remindersOk");
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
    render();
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
    render();
}

function render() {
    if (!progress || progress.finished || progress.hidden) {
        card?.remove();
        card = null;
        return;
    }
    const step = STEPS[progress.index];
    if (!card) {
        card = document.createElement("div");
        card.className = "coach";
        card.setAttribute("role", "status");
        document.body.append(card);
        card.addEventListener("click", onCardClick);
    }
    card.innerHTML = `
        <div class="coach-head">
            <span class="coach-part">${esc(step.part)} · <span class="mono">${progress.index + 1}/${STEPS.length}</span></span>
            <button class="icon-btn" data-coach="hide" aria-label="Свернуть">${ICONS.close}</button>
        </div>
        <div class="coach-bar"><i style="width: ${progress.index / STEPS.length * 100}%"></i></div>
        <div class="coach-title">${esc(step.title)}</div>
        <div class="coach-text">${esc(step.text)}</div>
        <div class="coach-btns">
            ${step.action ? `<button class="btn primary" data-coach="action">${esc(step.action[0])}</button>` : step.show ? `<button class="btn primary" data-coach="show">Показать</button>` : ""}
            <button class="btn ghost" data-coach="skip">Пропустить</button>
        </div>`;
}

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
    } else if (what === "show") {
        show(step);
    }
}

// переключить вкладку и подсветить нужное место
function show(step) {
    const [screen, selector] = step.show;
    document.querySelector(`.tab[data-screen="${screen}"]`)?.click();
    if (!selector) {
        return;
    }
    requestAnimationFrame(() => {
        const target = document.querySelector(selector);
        if (!target) {
            return;
        }
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.add("coach-target");
        setTimeout(() => target.classList.remove("coach-target"), 3200);
    });
}

function next(succeeded) {
    if (succeeded && card) {
        card.classList.add("coach-ok");
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
    document.body.style.overflow = "hidden";
    root.addEventListener("click", event => {
        const what = event.target.closest("[data-final]")?.dataset.final;
        if (what === "send") {
            haptic();
            send();
        } else if (what === "go") {
            haptic();
            root.remove();
            document.body.style.overflow = "";
            document.querySelector('.tab[data-screen="today"]')?.click();
        }
    });
}

