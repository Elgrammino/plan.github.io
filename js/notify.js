// Интерфейс напоминаний: блок в «Ещё», сверка по возвращении из Быстрых команд,
// «Вставить из буфера» (Siri, сверка, ответ Claude), инструкция по сборке команд.
import { getMeta, setMeta } from "./db.js";
import { relativeDay, timeText, toIso } from "./dates.js";
import { handleText, refresh as refreshMore } from "./more.js";
import { parseQuick } from "./parse.js";
import {
    SHORTCUT_SEND, SHORTCUT_SIRI, SHORTCUT_SYNC, applySync, lastSentAt, looksLikeSync,
    pendingChanges, readSync, reminderItems, runShortcut, sendToReminders
} from "./reminders.js";
import { newTask, saveTask, state } from "./store.js";
import { esc, haptic, openSheet, showToast } from "./ui.js";

const plural = (n, one, few, many) =>
    n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
const remindersWord = n => `${n} ${plural(n, "напоминание", "напоминания", "напоминаний")}`;
const when = iso => iso ? `${relativeDay(iso)} в ${timeText(iso)}` : "ещё не было";

// ---- блок в «Ещё» ----
export async function remindersCard() {
    const [lastSync, test, ok] = await Promise.all([getMeta("lastSyncAt"), getMeta("testReminderAt"), getMeta("remindersOk")]);
    const { changes } = pendingChanges();
    const sent = lastSentAt();
    const asking = test && !ok && Date.now() > new Date(test).getTime();
    return `
        <div class="label">Напоминания</div>
        <div class="card stack">
            <div class="check-row ${ok ? "ok" : "bad"}">
                <span class="dot"></span>
                <div class="what">
                    <div>${ok ? "Напоминания работают" : "Напоминания не настроены"}</div>
                    <div class="why">Отправка: ${esc(when(sent))}${sent && changes ? ` · изменений ${changes}` : ""}. Сверка: ${esc(when(lastSync))}.</div>
                </div>
            </div>
            ${asking ? `
                <div class="card notice">
                    Пришло напоминание «Проверка Плана»?
                    <div class="btns" style="margin-top: var(--sp-12)">
                        <button class="btn primary" data-notify="testYes">Да</button>
                        <button class="btn ghost" data-notify="testNo">Нет, помоги</button>
                    </div>
                </div>` : ""}
            <button class="btn ${ok ? "primary" : "ghost"} wide" data-notify="sync">Сверить и&nbsp;отправить</button>
            <button class="btn ghost wide" data-notify="send">Только отправить${changes ? ` · ${changes}` : ""}</button>
            <button class="btn ${ok ? "ghost" : "primary"} wide" data-notify="guide">Как собрать Быстрые команды</button>
            <button class="btn ghost wide" data-notify="test">Тест: напоминание через 2&nbsp;минуты</button>
        </div>`;
}

// кнопка на «Сегодня»: только после первой отправки и только когда есть что отправить
export function todayButton() {
    if (!lastSentAt()) {
        return "";
    }
    const { changes } = pendingChanges();
    return changes ? `<button class="chip-btn today-tool" data-notify="sync">В&nbsp;Напоминания · <span class="mono">${changes}</span></button>` : "";
}

export function onNotifyClick(event) {
    const button = event.target.closest("[data-notify]");
    if (!button) {
        return false;
    }
    haptic();
    switch (button.dataset.notify) {
        case "sync":
            startSync();
            break;
        case "send":
            send();
            break;
        case "guide":
            guideSheet();
            break;
        case "test":
            test();
            break;
        case "testYes":
            state.remindersOk = true;
            setMeta("remindersOk", true).then(refreshMore);
            showToast("Отлично: напоминания приходят");
            break;
        case "testNo":
            guideSheet("help");
            break;
    }
    return true;
}

export function send(items = reminderItems()) {
    sendToReminders(items).catch(() => showToast("Не получилось положить в буфер. Попробуй ещё раз."));
}

export async function test() {
    const at = new Date(Date.now() + 2 * 60000);
    // тест едет вместе с настоящими напоминаниями: команда заменяет все напоминания плана
    send([...reminderItems(), { key: "plan:test:1", title: "Проверка Плана", due: toIso(at), notes: "plan:test:1" }]);
    state.remindersOk = false;
    await setMeta("remindersOk", false);
    await setMeta("testReminderAt", toIso(at));
}

// ---- сверка: команда кладёт ответ в буфер, ты возвращаешься и вставляешь ----
function startSync() {
    setMeta("pendingSync", toIso(new Date())).then(() => runShortcut(SHORTCUT_SYNC));
}

// вызывается, когда приложение снова на экране
export async function resumeAfterShortcut() {
    const pending = await getMeta("pendingSync");
    if (!pending || Date.now() - new Date(pending) > 30 * 60000) {
        return false;
    }
    await setMeta("pendingSync", null);
    syncSheet();
    return true;
}

function syncSheet() {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Сверка</h2>
            <p class="text-2">Команда «${esc(SHORTCUT_SYNC)}» положила выполненное в&nbsp;буфер. Нажми «Вставить», потом iPhone спросит разрешение — подтверди.</p>
            <div id="syncResult"></div>
        </div>
        <div class="sheet-foot" id="syncFoot">
            <button class="btn ghost grow" data-close>Отмена</button>
            <button class="btn primary grow" id="paste">Вставить</button>
        </div>`);
    sheet.querySelector("[data-close]").addEventListener("click", close);
    sheet.querySelector("#paste").addEventListener("click", async () => {
        let text;
        try {
            text = await navigator.clipboard.readText();
        } catch (e) {
            showToast("iPhone не дал прочитать буфер. Попробуй ещё раз.");
            return;
        }
        if (!looksLikeSync(text)) {
            showToast("В буфере нет сверки. Запусти команду ещё раз.", null, null, 6000);
            return;
        }
        const result = readSync(text);
        const undo = await applySync(result);
        const { changes, items } = pendingChanges();
        sheet.querySelector("#syncResult").innerHTML = `
            <div class="card notice">
                Найдено в&nbsp;Напоминаниях: <span class="mono">${result.seen}</span>.
                Отмечено сделанным: <span class="mono">${result.done.length}</span>${result.done.length ? " — " + result.done.map(task => "«" + esc(task.title) + "»").join(", ") : ""}.
                ${result.moved.length ? `Время поменялось: <span class="mono">${result.moved.length}</span>.` : ""}
            </div>
            ${result.done.length || result.moved.length ? `<button class="chip-btn" id="undoSync" style="margin-top: var(--sp-8)">Отменить сверку</button>` : ""}`;
        sheet.querySelector("#syncFoot").innerHTML = `
            <button class="btn ghost grow" data-close>Закрыть</button>
            <button class="btn primary grow" id="sendNow">${changes ? `Отправить изменения · ${changes}` : `Отправить ${remindersWord(items.length)}`}</button>`;
        sheet.querySelector("#syncFoot [data-close]").addEventListener("click", close);
        sheet.querySelector("#sendNow").addEventListener("click", () => {
            haptic();
            close();
            send();
        });
        sheet.querySelector("#undoSync")?.addEventListener("click", async () => {
            await undo();
            showToast("Сверка отменена");
            close();
        });
    });
}

// ---- «Вставить из буфера»: сверка, пакет Claude или продиктованное через Siri ----
export async function pasteFromClipboard() {
    let text;
    try {
        text = (await navigator.clipboard.readText()).trim();
    } catch (e) {
        showToast("iPhone не дал прочитать буфер");
        return;
    }
    if (!text) {
        showToast("Буфер пуст");
        return;
    }
    if (looksLikeSync(text)) {
        syncSheet();
        return;
    }
    if (text.includes('"reminders"')) {
        showToast("В буфере то, что уже ушло в Напоминания");
        return;
    }
    if (/^[\s`]*(json)?\s*[{[]/.test(text) || text.includes('"items"')) {
        handleText(text);
        return;
    }
    dictatedSheet(text);
}

// каждая строка — задача, разбор как в быстром вводе
function dictatedSheet(text) {
    const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, 30);
    const tasks = lines.map(line => parseQuick(line, { lists: state.lists })).filter(fields => fields.title);
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Из буфера</h2>
            ${tasks.map(fields => `
                <div class="preview-row">
                    <div>${esc(fields.title)}</div>
                    <div class="sub">${fields.plannedAt ? esc(relativeDay(fields.plannedAt)) + (fields.plannedAt.includes("T") ? " в " + timeText(fields.plannedAt) : "") : "во Входящие"}</div>
                </div>`).join("")}
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" data-close>Отмена</button>
            <button class="btn primary grow" id="addAll">Добавить ${tasks.length}</button>
        </div>`);
    sheet.querySelector("[data-close]").addEventListener("click", close);
    sheet.querySelector("#addAll").addEventListener("click", () => {
        haptic();
        tasks.forEach(fields => saveTask(newTask(fields)));
        close();
        showToast(`Добавлено: ${tasks.length}`);
        navigator.clipboard.writeText("").catch(() => { }); // чтобы не предлагать то же самое снова
    });
}

// ---- мастер Быстрых команд: шаги с галочками, прогресс хранится ----
// Названия действий — как в iOS на русском; у спорных шагов «Не нахожу?» с другими вариантами
// (в iOS 18 «Добавить новое напоминание» заменили на «Создать напоминание»).
const GUIDE = [
    {
        id: "prep", title: "0. Подготовка", intro: "Один раз, до сборки команд.",
        steps: [
            ["В «Напоминаниях» создай список <b>План</b>: «Добавить список» внизу."],
            ["Настройки → Приложения → Быстрые команды → Дополнения: включи <b>«Разрешить удаление без подтверждения»</b>.",
                "Если пункта нет — ничего страшного: при первом запуске команда спросит, можно ли удалить напоминания. Ответь «Всегда разрешать» или «Удалить»."]
        ]
    },
    {
        id: "send", title: `1. «${SHORTCUT_SEND}»`, intro: "Удаляет открытые напоминания плана и создаёт присланные. Действия ищутся строкой поиска внизу экрана команды.",
        steps: [
            [`Быстрые команды → «+» → нажми название вверху и назови точно <b>${SHORTCUT_SEND}</b> — с двоеточием и пробелом.`],
            ["Добавь <b>Получить буфер обмена</b>.", "По-английски Get Clipboard. Поиск по слову «буфер»."],
            ["<b>Получить словарь из входных данных</b> — вход «Буфер обмена».", "Get Dictionary from Input. Поиск по слову «словарь»."],
            ["<b>Получить значение словаря</b>: «Значение» для ключа <code>reminders</code> в «Словарь».", "Нажми синее «Ключ» и впиши reminders латиницей."],
            ["<b>Найти напоминания</b> → «Добавить фильтр»: <i>Заметки</i> · <i>содержат</i> · <code>plan:</code>. Ещё фильтр: <i>Выполнено</i> · <i>нет</i>.",
                "Find Reminders. Может называться «Найти все напоминания, где…». Фильтр «Выполнено» иногда звучит как «Завершено»."],
            ["<b>Удалить напоминания</b> — «Напоминания» из прошлого шага.", "Remove Reminders. Поиск по слову «удалить»."],
            ["<b>Повторить с каждым</b> — элементы: «Значение словаря» из шага 4.", "Repeat with Each. Если подставилось не то, нажми на поле и выбери переменную."],
            ["Внутри повтора: <b>Получить значение словаря</b>, ключ <code>title</code>, словарь — «Повторяемый объект». Нажми на результат → «Переименовать» → <i>Название</i>.",
                "«Повторяемый объект» в новых iOS — «Элемент повтора» (Repeat Item)."],
            ["Так же ключ <code>due</code> → переименуй в <i>Срок</i>."],
            ["Так же ключ <code>notes</code> → переименуй в <i>Заметки</i>."],
            ["<b>Получить даты из входных данных</b> — из «Срок».", "Get Dates from Input. Поиск по слову «даты»."],
            ["<b>Создать напоминание</b>: текст — «Название», список — <i>План</i>, <i>Срок</i> — «Даты» (со временем, «Весь день» выключен), заметки — «Заметки».",
                "В старых iOS действие называется «Добавить новое напоминание»: раскрой стрелку → включи «Напомнить» → дата «Даты»."],
            ["После «Конец повтора»: <b>Показать уведомление</b> «Напоминания обновлены». По желанию."]
        ]
    },
    {
        id: "sync", title: `2. «${SHORTCUT_SYNC}»`, intro: "Собирает отмеченное в Напоминаниях и кладёт в буфер. По возвращении План сам предложит «Вставить».",
        steps: [
            [`Новая команда, название точно <b>${SHORTCUT_SYNC}</b>.`],
            ["<b>Найти напоминания</b>: фильтр <i>Заметки</i> · <i>содержат</i> · <code>plan:</code>."],
            ["<b>Повторить с каждым</b> — «Напоминания»."],
            ["Внутри: <b>Получить сведения о напоминаниях</b> → <i>Заметки</i> из «Повторяемый объект».", "Get Details of Reminders. Поиск по слову «сведения»."],
            ["<b>Сопоставить текст</b>: шаблон <code>plan:[A-Za-z0-9_@-]+:\\d</code>, текст — «Заметки».", "Match Text. Шаблон вставь целиком, без пробелов."],
            ["<b>Получить сведения о напоминаниях</b> → <i>Выполнено</i> из «Повторяемый объект».", "Может называться «Завершено» или Is Completed."],
            ["<b>Получить сведения о напоминаниях</b> → <i>Срок</i> из «Повторяемый объект».", "Может называться «Дата исполнения», «Дата выполнения» или Due Date."],
            ["<b>Форматировать дату</b>: дата — «Срок», формат <i>ISO 8601</i>, включи время.", "Format Date. Формат выбирается в строке «Формат даты»."],
            ["<b>Текст</b>: вставь переменные «Совпадения», «Выполнено», «Отформатированная дата» через вертикальную черту <code>|</code>.",
                "Пример того, что получится: plan:t-1a2b:1|Да|2026-10-20T10:00:00+03:00. Черта есть на цифровой клавиатуре, «#+=»."],
            ["После «Конец повтора»: <b>Объединить текст</b> «Результаты повтора» через <i>Новые строки</i>.", "Combine Text."],
            ["<b>Скопировать в буфер обмена</b>."],
            ["<b>Показать уведомление</b> «Сверка готова, вернись в План»."]
        ]
    },
    {
        id: "siri", title: `3. Siri: «${SHORTCUT_SIRI}»`, intro: "Сразу в приложение команда записать не может: по ссылке открылся бы Safari со своим отдельным хранилищем. Поэтому — через буфер.",
        steps: [
            [`Новая команда <b>${SHORTCUT_SIRI}</b>: добавь <b>Диктовать текст</b>.`],
            ["<b>Скопировать в буфер обмена</b>."],
            ["<b>Показать уведомление</b> «Записал. Открой План — он предложит вставить»."],
            [`Проверь: «Привет, Siri, ${SHORTCUT_SIRI.toLowerCase()}» → «завтра в 10 позвонить в банк» → открой План → «Вставить» в подсказке внизу.`]
        ]
    },
    {
        id: "widget", title: "4. План на экране блокировки", intro: "Приложение с экрана «Домой» не умеет виджеты, а Напоминания умеют.",
        steps: [
            ["Долгое нажатие на экран блокировки → «Настроить» → экран блокировки → «Добавить виджеты» → <b>Напоминания</b> → список <i>План</i>."],
            ["По желанию так же на экран «Домой»."]
        ]
    }
];

const HELP = `
    <details id="help"><summary>Напоминание не пришло</summary>
        <ol>
            <li>Открой «Напоминания» → список <i>План</i>. Есть «Проверка Плана»? Если нет — команда не запустилась или называется не точно «${SHORTCUT_SEND}».</li>
            <li>Есть, но без времени — в «Создать напоминание» не задан срок со временем (или в старом действии не включено «Напомнить»).</li>
            <li>Есть со временем, но тихо — Настройки → Уведомления → Напоминания: разрешены ли уведомления; не включён ли режим фокусировки.</li>
            <li>Команда спрашивает про удаление — см. шаг 0.</li>
            <li>Ошибка «словарь» или «значение» — проверь, что команда начинается с «Получить буфер обмена», а ключ написан латиницей: reminders.</li>
        </ol>
    </details>`;

export async function guideSheet(open = null) {
    const checks = (await getMeta("guideChecks")) || {};
    const { sheet, close } = openSheet(`
        <div class="sheet-body guide">
            <h2>Быстрые команды</h2>
            <p class="text-2">Собери по шагам и ставь галочки — прогресс сохранится. Минут 15. Потом «Тест: напоминание через 2 минуты».</p>
            <div id="guideParts"></div>
            ${HELP}
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" data-notify-test>Тест через 2&nbsp;минуты</button>
            <button class="btn primary grow" data-close>Готово</button>
        </div>`);
    sheet.classList.add("tall");

    const render = () => {
        sheet.querySelector("#guideParts").innerHTML = GUIDE.map(part => {
            const done = part.steps.filter((_, i) => checks[`${part.id}-${i}`]).length;
            const complete = done === part.steps.length;
            // открыт первый незаконченный раздел
            const firstOpen = GUIDE.find(item => item.steps.some((_, i) => !checks[`${item.id}-${i}`]));
            return `
                <details ${part === firstOpen ? "open" : ""} class="${complete ? "complete" : ""}">
                    <summary><span>${part.title}</span><span class="mono guide-count">${complete ? "✓" : `${done}/${part.steps.length}`}</span></summary>
                    <p class="text-2">${part.intro}</p>
                    ${part.steps.map(([text, alt], i) => `
                        <div class="guide-step">
                            <label><input type="checkbox" data-check="${part.id}-${i}" ${checks[`${part.id}-${i}`] ? "checked" : ""}><span>${text}</span></label>
                            ${alt ? `<details class="alt"><summary>Не нахожу?</summary><p>${alt}</p></details>` : ""}
                        </div>`).join("")}
                </details>`;
        }).join("");
    };
    render();

    sheet.querySelector("#guideParts").addEventListener("change", event => {
        const key = event.target.dataset.check;
        if (!key) {
            return;
        }
        haptic();
        checks[key] = event.target.checked;
        setMeta("guideChecks", checks);
        // раздел закончен — открываем следующий
        const part = GUIDE.find(item => key.startsWith(item.id + "-"));
        if (part.steps.every((_, i) => checks[`${part.id}-${i}`])) {
            render();
        } else {
            const summary = event.target.closest("details").querySelector(".guide-count");
            summary.textContent = `${part.steps.filter((_, i) => checks[`${part.id}-${i}`]).length}/${part.steps.length}`;
        }
    });
    sheet.querySelector("[data-notify-test]").addEventListener("click", () => {
        haptic();
        test();
        close();
    });
    if (open) {
        const section = sheet.querySelector("#" + open);
        section.open = true;
        requestAnimationFrame(() => section.scrollIntoView());
    }
    sheet.querySelector("[data-close]").addEventListener("click", close);
}
