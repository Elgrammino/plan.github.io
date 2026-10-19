// Знакомство с приложением: что это → настройка с проверками → ритуалы → большая выгрузка → первый день.
// Шаг хранится в базе: закрыл приложение посреди — продолжишь с того же места.
// Плюс одна короткая подсказка на каждой вкладке при первом открытии.
import { getMeta, setMeta } from "./db.js";
import { dayKey, durationText, toIso } from "./dates.js";
import { openDump } from "./dump.js";
import { exportForClaude, makeBackup, saveFile } from "./exchange.js";
import { guideSheet, send, test } from "./notify.js";
import { openSettings } from "./settings.js";
import { dayTasks, inboxTasks, overdueTasks, saveSettings, state } from "./store.js";
import { ICONS, esc, haptic, showToast } from "./ui.js";

const isStandalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

const INTRO = [
    {
        title: "План живёт в&nbsp;этом телефоне",
        text: "Никаких серверов и&nbsp;аккаунтов. Задачи лежат только здесь, поэтому раз в&nbsp;неделю сохраняй бэкап в&nbsp;«Файлы».",
        icon: `<svg viewBox="0 0 64 64"><rect x="18" y="6" width="28" height="52" rx="6"/><path d="M28 50h8"/></svg>`
    },
    {
        title: "Звонят Напоминания iOS",
        text: "Сам сайт будить телефон не&nbsp;умеет. Поэтому задачи со временем уходят в&nbsp;штатные Напоминания, и&nbsp;те звонят даже на&nbsp;заблокированном экране.",
        icon: `<svg viewBox="0 0 64 64"><path d="M20 44V30a12 12 0 0 1 24 0v14l4 4H16z"/><path d="M28 52a4 4 0 0 0 8 0"/></svg>`
    },
    {
        title: "Claude собирает планы",
        text: "Просишь в&nbsp;чате, например, расписание рилсов на&nbsp;месяц, копируешь ответ и&nbsp;вставляешь сюда. Перед импортом видно, что добавится.",
        icon: `<svg viewBox="0 0 64 64"><path d="M10 14h44v28H30l-10 8v-8H10z"/><path d="M20 24h24M20 32h14"/></svg>`
    }
];

// порядок шагов; intro-0..2 — вводные экраны
const STEPS = ["intro-0", "intro-1", "intro-2", "setup", "rituals", "dump", "firstDay"];

let root = null;
let onFinish = null;
let current = 0;

// finish(screen): после знакомства открыть вкладку
export async function openOnboarding(finish, from = null) {
    onFinish = finish;
    const saved = await getMeta("onboardingStep");
    current = Math.max(0, STEPS.indexOf(from || saved || STEPS[0]));
    render();
}

// первый запуск на чистом телефоне — или незаконченное знакомство
export async function maybeStartOnboarding(finish) {
    const [done, step] = await Promise.all([getMeta("onboardingDone"), getMeta("onboardingStep")]);
    if (done) {
        return false;
    }
    if (step || !state.tasks.size) {
        openOnboarding(finish);
        return true;
    }
    return false;
}

function go(step) {
    current = Math.min(STEPS.length - 1, Math.max(0, step));
    setMeta("onboardingStep", STEPS[current]);
    render();
}

function close() {
    root?.remove();
    root = null;
    document.body.style.overflow = "";
}

async function finish(screen = "today") {
    haptic();
    await Promise.all([setMeta("onboardingDone", true), setMeta("onboardingStep", null)]);
    close();
    onFinish ? onFinish(screen) : document.querySelector(`.tab[data-screen="${screen}"]`)?.click();
}

function frame(body, foot) {
    if (!root) {
        root = document.createElement("div");
        root.className = "dump onboarding";
        root.setAttribute("role", "dialog");
        document.body.append(root);
        document.body.style.overflow = "hidden";
    }
    const dots = STEPS.map((_, i) => `<i class="${i === current ? "on" : i < current ? "past" : ""}"></i>`).join("");
    root.innerHTML = `
        <div class="dump-top">
            <button class="icon-btn" data-skip aria-label="Закрыть">${ICONS.close}</button>
            <span class="dots" aria-label="Шаг ${current + 1} из ${STEPS.length}">${dots}</span>
            <span style="width: var(--tap)"></span>
        </div>
        <div class="onboarding-body">${body}</div>
        <div class="btns onboarding-foot">${foot}</div>`;
    // крестик откладывает знакомство: шаг запомнен, продолжить можно из «Ещё»
    root.querySelector("[data-skip]").addEventListener("click", () => {
        close();
        showToast("Продолжить знакомство можно в «Ещё»");
    });
    return selector => root.querySelector(selector);
}

const nav = (next = "Дальше", back = current > 0) =>
    `${back ? `<button class="btn ghost" data-back>Назад</button>` : ""}<button class="btn primary" data-next>${next}</button>`;

function bindNav($) {
    $("[data-back]")?.addEventListener("click", () => go(current - 1));
    $("[data-next]")?.addEventListener("click", () => {
        haptic();
        go(current + 1);
    });
}

function render() {
    const step = STEPS[current];
    if (step.startsWith("intro")) {
        const intro = INTRO[+step.slice(6)];
        bindNav(frame(`
            <svg class="onboarding-icon" viewBox="0 0 64 64">${intro.icon.replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
            <h1 class="title">${intro.title}</h1>
            <p class="lead">${intro.text}</p>`, nav(current === 2 ? "Настроить" : "Дальше")));
    } else if (step === "setup") {
        setupStep();
    } else if (step === "rituals") {
        ritualsStep();
    } else if (step === "dump") {
        dumpStep();
    } else {
        firstDayStep();
    }
}

// ---- настройка: каждый пункт с проверкой ----
async function setupStep() {
    const [persisted, backup, remindersOk, testAt] = await Promise.all([
        navigator.storage?.persisted?.() ?? null,
        getMeta("lastBackupAt"),
        getMeta("remindersOk"),
        getMeta("testReminderAt")
    ]);
    const row = (ok, title, text, actions = "") => `
        <div class="check-row ${ok ? "ok" : "bad"}">
            <span class="dot"></span>
            <div class="what">
                <div>${title}</div>
                <div class="why">${text}</div>
                ${!ok && actions ? `<div class="row-actions">${actions}</div>` : ""}
            </div>
        </div>`;
    const testSent = testAt && !remindersOk;
    const $ = frame(`
        <h1 class="title">Настройка</h1>
        <p class="lead">По&nbsp;порядку, у&nbsp;каждого пункта своя галочка. Что не&nbsp;получается сейчас — можно потом из&nbsp;«Ещё».</p>
        <div class="card">
            ${row(isStandalone(), "Открыто с&nbsp;домашнего экрана",
                isStandalone() ? "Так iOS не&nbsp;стирает данные."
                    : "В&nbsp;Safari нажми «Поделиться» (квадрат со&nbsp;стрелкой внизу; в&nbsp;новой iOS — в&nbsp;меню «•••») → «На&nbsp;экран «Домой»». Потом открой План иконкой и&nbsp;продолжи там.")}
            ${row(persisted === true, "Данные защищены",
                persisted === true ? "Система обещала не&nbsp;удалять хранилище." : "Попроси систему не&nbsp;стирать данные. С&nbsp;домашнего экрана обычно соглашается.",
                `<button class="chip-btn" data-act="persist">Защитить</button>`)}
            ${row(!!backup, "Первый бэкап",
                backup ? "Сохранён. Дальше — раз в&nbsp;неделю, Напоминания подскажут." : "Сохрани файл в&nbsp;«Файлы» или iCloud Drive — так поймёшь, где его потом искать.",
                `<button class="chip-btn" data-act="backup">Сохранить бэкап</button>`)}
            ${row(remindersOk === true, "Напоминания",
                remindersOk ? "Тест пришёл — всё работает."
                    : testSent ? "Тест отправлен. Пришло «Проверка Плана»?"
                    : "Собери три Быстрые команды по&nbsp;инструкции (минут&nbsp;15), потом проверь тестом. У&nbsp;Напоминаний должны быть включены уведомления.",
                testSent
                    ? `<button class="chip-btn" data-act="testYes">Да, пришло</button><button class="chip-btn" data-act="testNo">Нет, помоги</button>`
                    : `<button class="chip-btn" data-act="guide">Инструкция</button><button class="chip-btn" data-act="test">Тест через 2&nbsp;мин</button>`)}
        </div>`, nav());
    bindNav($);

    root.querySelector(".card").addEventListener("click", async event => {
        const act = event.target.closest("[data-act]")?.dataset.act;
        if (!act) {
            return;
        }
        haptic();
        if (act === "persist") {
            const ok = await navigator.storage?.persist?.();
            showToast(ok ? "Данные защищены" : "Система пока не согласилась. Открой План с домашнего экрана и попробуй снова.", null, null, 6000);
        } else if (act === "backup") {
            if (await saveFile(`plan-backup-${dayKey(new Date())}.json`, JSON.stringify(makeBackup()))) {
                await setMeta("lastBackupAt", toIso(new Date()));
            }
        } else if (act === "guide") {
            guideSheet();
            return;
        } else if (act === "test") {
            await test();
        } else if (act === "testYes") {
            await setMeta("remindersOk", true);
        } else if (act === "testNo") {
            guideSheet("help");
            return;
        }
        setupStep();
    });
}

// ---- ритуалы: время, лимит, списки ----
function ritualsStep() {
    const settings = state.settings;
    const $ = frame(`
        <h1 class="title">Ритуалы</h1>
        <p class="lead">Утром смотришь план, вечером выгружаешь голову. Напоминания придут в&nbsp;это время.</p>
        <div class="field">
            <div class="row"><span class="text-2 row-label">Утро</span><input class="input" type="time" id="morning" value="${settings.morning}"></div>
            <div class="row" style="margin-top: var(--sp-8)"><span class="text-2 row-label">Вечер</span><input class="input" type="time" id="evening" value="${settings.evening}"></div>
        </div>
        <div class="field"><div class="label">Сколько часов задач в&nbsp;день — нормально</div>
            <div class="row">
                <input class="input every" type="number" inputmode="decimal" min="1" max="16" step="0.5" id="limit" value="${settings.dayLimitMin / 60}">
                <span class="text-2">ч&nbsp;— больше полоса дня покраснеет</span>
            </div>
        </div>
        <div class="field"><div class="label">Списки</div>
            <p class="text-2" style="margin: 0 0 var(--sp-8)">${state.lists.map(list => esc(list.name)).join(" · ")}</p>
            <button class="chip-btn" id="editLists">Изменить списки</button>
        </div>`, nav());
    const save = () => {
        settings.morning = $("#morning").value || settings.morning;
        settings.evening = $("#evening").value || settings.evening;
        settings.dayLimitMin = Math.round(Math.min(16, Math.max(1, +$("#limit").value || 7)) * 2) * 30;
        saveSettings();
    };
    $("[data-back]").addEventListener("click", save, { capture: true });
    $("[data-next]").addEventListener("click", save, { capture: true });
    bindNav($);
    $("#editLists").addEventListener("click", () => {
        openSettings("lists");
        // после закрытия шторки списков обновляем строку с названиями
        const sheets = document.querySelectorAll(".sheet");
        sheets[sheets.length - 1]?.querySelector("[data-close]")?.addEventListener("click", () => ritualsStep());
    });
}

// ---- большая выгрузка ----
function dumpStep() {
    const draft = state.dump;
    const $ = frame(`
        <h1 class="title">Большая выгрузка</h1>
        <p class="lead">25&nbsp;минут вытаскиваешь из&nbsp;головы всё: выступления и&nbsp;заказы, реквизит, Instagram, дом и&nbsp;семья, деньги и&nbsp;документы, что висит дольше месяца. Подсказки будут меняться сами.</p>
        <p class="text-2">Потом разложишь мысли колодой: вправо — в&nbsp;план, влево — удалить.</p>`,
        `<button class="btn ghost" data-skipDump>Пропустить</button>
         <button class="btn primary" id="startDump">${draft ? "Продолжить выгрузку" : "Начать · 25 мин"}</button>`);
    $("[data-skipDump]").addEventListener("click", () => go(current + 1));
    $("#startDump").addEventListener("click", () => {
        haptic();
        close();
        // после выгрузки знакомство продолжается с первого дня
        setMeta("onboardingStep", "firstDay");
        openDump(() => openOnboarding(onFinish, "firstDay"), 25);
    });
}

// ---- первый день ----
function firstDayStep() {
    const today = dayTasks(dayKey(new Date()));
    const todayCount = today.timed.length + today.anytime.length;
    const inbox = inboxTasks().length;
    const late = overdueTasks().length;
    const minutes = [...today.timed, ...today.anytime].reduce((sum, task) => sum + (task.durationMin || 0), 0);
    const $ = frame(`
        <h1 class="title">Первый день</h1>
        <p class="lead">На&nbsp;сегодня ${todayCount ? `<b>${todayCount}</b>${minutes ? ", это " + durationText(minutes) : ""}` : "пока ничего"}. Во&nbsp;Входящих <b>${inbox}</b>${late ? `, просрочено <b>${late}</b>` : ""}.</p>
        <div class="card stack">
            ${inbox ? `<button class="btn ghost wide" id="toInbox">Разложить Входящие по&nbsp;дням</button>` : ""}
            <button class="btn ghost wide" id="send">Отправить в&nbsp;Напоминания</button>
            <button class="btn ghost wide" id="claude">Отдать Claude на&nbsp;разбор</button>
            <p class="hint">Claude получит план в&nbsp;буфере: вставь его в&nbsp;чат вместе с&nbsp;форматом («Ещё → Скопировать формат») и&nbsp;попроси разложить. Ответ вставишь в&nbsp;«Ещё → Вставить текст».</p>
        </div>`, `<button class="btn ghost" data-back>Назад</button><button class="btn primary" id="done">Готово</button>`);
    $("[data-back]").addEventListener("click", () => go(current - 1));
    $("#done").addEventListener("click", () => finish("today"));
    $("#toInbox")?.addEventListener("click", () => finish("inbox"));
    $("#send").addEventListener("click", () => {
        haptic();
        send();
    });
    $("#claude").addEventListener("click", () => {
        haptic();
        navigator.clipboard.writeText(JSON.stringify(exportForClaude(), null, 1))
            .then(() => showToast("План в буфере. Вставь его в чат с Claude.", null, null, 5000))
            .catch(() => showToast("Не получилось скопировать"));
    });
}

// ---- подсказки на вкладках ----
const HINTS = {
    today: "Свайп по&nbsp;задаче: вправо — готово, влево — перенести. Лупа справа — поиск.",
    inbox: "Здесь задачи без дня. «Сегодня» справа забирает задачу в&nbsp;план на&nbsp;сегодня.",
    calendar: "Месяц целиком. Пустой кружок — будущий раз повтора. «+» добавит задачу на выбранный день.",
    content: "Публикации по стадиям: идея → сценарий → снято → смонтировано → вышло. «+» — новая идея.",
    more: "Здесь напоминания, настройки, обмен с&nbsp;Claude и&nbsp;бэкап."
};

let hintsSeen = {};

export async function loadHints() {
    hintsSeen = (await getMeta("hintsSeen")) || {};
}

export function resetHints() {
    hintsSeen = {};
    return setMeta("hintsSeen", hintsSeen);
}

// вставить подсказку после заголовка экрана, если её ещё не закрывали
export function showHint(el, screen) {
    if (hintsSeen[screen] || !HINTS[screen] || el.querySelector(".screen-hint")) {
        return;
    }
    const anchor = el.querySelector(".bar, .subtitle, .segmented") || el.querySelector(".title");
    const html = `<div class="card notice screen-hint"><span>${HINTS[screen]}</span><button class="chip-btn" data-hint="${screen}">Понятно</button></div>`;
    anchor ? anchor.insertAdjacentHTML("afterend", html) : el.insertAdjacentHTML("afterbegin", html);
}

export function dismissHint(screen) {
    hintsSeen[screen] = true;
    setMeta("hintsSeen", hintsSeen);
    document.querySelectorAll(".screen-hint").forEach(hint => hint.querySelector(`[data-hint="${screen}"]`) && hint.remove());
}
