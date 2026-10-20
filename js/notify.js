// Интерфейс напоминаний: блок в «Ещё», сверка по возвращении из Быстрых команд,
// «Вставить из буфера» (Siri, сверка, ответ Claude), инструкция по сборке команд.
import { getMeta, setMeta } from "./db.js";
import { plural, relativeDay, timeText, toIso } from "./dates.js";
import { handleText, refresh as refreshMore } from "./more.js";
import { parseQuick } from "./parse.js";
import {
    SHORTCUT_SEND, SHORTCUT_SIRI, SHORTCUT_SYNC, applySync, lastSentAt, looksLikeSync,
    pendingChanges, readSync, reminderItems, runShortcut, sendToReminders
} from "./reminders.js";
import { newTask, saveTask, state } from "./store.js";
import { esc, haptic, openSheet, showToast } from "./ui.js";

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
// Названия — официальные русские строки iOS 26 (WorkflowKit/ActionKit, сверено по applelocalization.com 20.10)
// и скриншоты Эдуарда. Шаг: find — что набрать в «Поиске действий», name — как действие зовётся в списке,
// block — как блок выглядит в команде ([поле] — синее поле), set — что настроить, alt — «Не получается?».
// Готовая команда ставится одним нажатием по ссылке iCloud: ссылки вписываются сюда, пустая — только ручная сборка.
const SHORTCUT_LINKS = {
    send: "https://www.icloud.com/shortcuts/a6bd3eec82234147b8d21c9a766af3e7",
    sync: "https://www.icloud.com/shortcuts/89f883d1d2244cdc956e73541fea08c0",
    siri: "https://www.icloud.com/shortcuts/02335f2e64334334993553a5e9316be5"
};

const PICK = "нажми поле → «Выбрать переменную» → коснись блока";
const INSIDE = "Новые действия встают в самый конец — перетащи блок выше «Конец повтора».";

// собирается при каждом открытии: в разделе «Ритуалы» время из настроек
const guideParts = () => [
    {
        id: "prep", title: "0. Подготовка", intro: "Один раз, до сборки команд.",
        steps: [
            { set: "Открой «Напоминания» → внизу «Добавить список» → назови <code>План</code>." },
            { set: "Настройки → Приложения → Быстрые команды → Дополнения → включи <b>«Удаление без подтверждения»</b>.",
                alt: "Если пункта нет — при первом запуске команда сама спросит, можно ли удалять напоминания. Ответь «Всегда разрешать»." }
        ]
    },
    {
        id: "send", title: `1. «${SHORTCUT_SEND}»`, intro: "Удаляет старые напоминания плана и создаёт присланные. Действия ищутся строкой «Поиск действий» внизу экрана.",
        steps: [
            { set: `Быстрые команды → «+» вверху → нажми название вверху → «Переименовать» → <code>${SHORTCUT_SEND}</code> (с двоеточием и пробелом).` },
            { find: "буфер", name: "Получить буфер обмена", block: "Получить буфер обмена" },
            { find: "словарь", name: "Получить словарь из входных данных", block: "Получить словарь из [Буфер обмена]", set: "Поле подставится само." },
            { find: "значение словаря", name: "Получить значение словаря", block: "Получить значение «[Значение]» для ключа «[Ключ]» в [Словарь]",
                set: "Нажми «Ключ» → впиши <code>reminders</code> латиницей." },
            { find: "найти напоминания", name: "Найти напоминания", block: "Найти [Напоминания] по критерию:",
                set: "«Добавить фильтр» → <b>Заметки</b> · <b>содержит</b> · <code>plan:</code>. Ещё раз «Добавить фильтр» → <b>Завершено</b> · выключено.",
                alt: "Без фильтра «Завершено» команда удалит и уже отмеченные напоминания." },
            { find: "удалить напоминания", name: "Удалить напоминания", block: "Удалить напоминания [Напоминания]", set: "Поле подставится само." },
            { find: "повторить", name: "Повторить для каждого объекта", block: "Повторить для каждого объекта в [Значение словаря]",
                set: "Под ним появится «Конец повтора». Следующие шесть действий должны стоять <b>между</b> ними.",
                alt: `Если в поле не «Значение словаря» — ${PICK} «Получить значение … reminders».` },
            { find: "значение словаря", name: "Получить значение словаря", block: "Получить значение «[Значение]» для ключа «[title]» в [Повтор объекта]",
                set: `Ключ <code>title</code>. Последнее поле — <b>Повтор объекта</b>: ${PICK} «Повторить для каждого объекта».`, alt: INSIDE },
            { find: "значение словаря", name: "Получить значение словаря", block: "Получить значение «[Значение]» для ключа «[due]» в [Повтор объекта]",
                set: "Ключ <code>due</code>. Последнее поле — тоже <b>Повтор объекта</b>, не «Значение словаря».",
                alt: "Все три результата называются одинаково, «Значение словаря», поэтому источник всегда «Повтор объекта»." },
            { find: "значение словаря", name: "Получить значение словаря", block: "Получить значение «[Значение]» для ключа «[notes]» в [Повтор объекта]",
                set: "Ключ <code>notes</code>, последнее поле — <b>Повтор объекта</b>." },
            { find: "даты", name: "Получить даты из входных данных", block: "Получить даты из [Значение словаря]",
                set: `Поле — результат шага с <code>due</code>: ${PICK} с ключом <code>due</code>.` },
            { find: "напоминание", name: "Добавить новое напоминание", block: "Добавить напоминание [Напоминание] в [Напоминания], [Без предупреждения]",
                set: `Первое поле — название: ${PICK} с ключом <code>title</code>. Второе поле — список <code>План</code>.` },
            { block: "… [Без предупреждения]",
                set: "В этом же блоке нажми <b>«Без предупреждения»</b> → <b>«С предупреждением»</b>. Появятся <b>«По времени»</b> и поле <b>«Время напоминания»</b> — туда «Даты».",
                alt: "Если оставить «Без предупреждения», напоминание появится в списке, но не позвонит." },
            { block: "… [›]", set: `В этом же блоке нажми стрелку <b>›</b> справа → поле <b>Заметки</b>: ${PICK} с ключом <code>notes</code>.`,
                alt: "По заметке plan:… План узнаёт свои напоминания. Без неё «Сверить» ничего не найдёт." },
            { find: "уведомление", name: "Показать уведомление", block: "Показать уведомление [Напоминания обновлены]",
                set: "Ниже «Конец повтора». Текст: <code>Напоминания обновлены</code>. По желанию: можно не добавлять." }
        ]
    },
    {
        id: "sync", title: `2. «${SHORTCUT_SYNC}»`, intro: "Собирает отмеченное в Напоминаниях и кладёт в буфер. По возвращении План сам предложит «Вставить».",
        steps: [
            { set: `Новая команда: «+» → «Переименовать» → <code>${SHORTCUT_SYNC}</code>.` },
            { find: "найти напоминания", name: "Найти напоминания", block: "Найти [Напоминания] по критерию:",
                set: "«Добавить фильтр» → <b>Заметки</b> · <b>содержит</b> · <code>plan:</code>." },
            { find: "повторить", name: "Повторить для каждого объекта", block: "Повторить для каждого объекта в [Напоминания]",
                set: "Следующие семь действий — между ним и «Конец повтора»." },
            { find: "сведения о напоминаниях", name: "Получить сведения о напоминаниях", block: "Получить [Сведения] из [Повтор объекта]",
                set: "Нажми первое поле → <b>Заметки</b>. Второе — «Повтор объекта».", alt: INSIDE },
            { find: "сопоставить", name: "Сопоставить текст", block: "Сопоставить с [шаблон] в [текст]",
                set: "Шаблон: <code>plan:[A-Za-z0-9_@-]+:\\d</code> — вставь целиком. Текст — результат «Заметки» из прошлого блока." },
            { find: "сведения о напоминаниях", name: "Получить сведения о напоминаниях", block: "Получить [Завершено] из [Повтор объекта]",
                set: "Первое поле → <b>Завершено</b>. Второе — «Повтор объекта»." },
            { find: "сведения о напоминаниях", name: "Получить сведения о напоминаниях", block: "Получить [Дата выполнения] из [Повтор объекта]",
                set: "Первое поле → <b>Дата выполнения</b>. Второе — «Повтор объекта»." },
            { find: "форматировать дату", name: "Форматировать дату", block: "Форматировать дату [Дата выполнения]",
                set: "Стрелка <b>›</b> → «Формат даты» → <b>ISO 8601</b>, включи <b>«Время в формате ISO 8601»</b>." },
            { find: "текст", name: "Текст", block: "[Текст]",
                set: "В поле по очереди: «Выбрать переменную» → <b>Совпадения</b>, знак <code>|</code>, переменная <b>Завершено</b>, знак <code>|</code>, результат «Форматировать дату». Без пробелов.",
                alt: "Получится строка вида plan:t-1a2b:1|Да|2026-10-20T10:00:00+03:00. Черта | — на клавиатуре «#+=»." },
            { find: "объединить текст", name: "Объединить текст", block: "Объединить [Результаты повторов] и [разделитель]",
                set: "Ниже «Конец повтора». Текст — <b>Результаты повторов</b>. Разделитель — перенос строки, не пробелы." },
            { find: "скопировать", name: "Скопировать в буфер обмена", block: "Скопировать [Объединённый текст] в буфер обмена" },
            { find: "уведомление", name: "Показать уведомление", block: "Показать уведомление [Сверка готова, вернись в План]", set: "Текст: <code>Сверка готова, вернись в План</code>." }
        ]
    },
    {
        id: "siri", title: `3. Siri: «${SHORTCUT_SIRI}»`, intro: "Сразу в приложение команда записать не может: по ссылке открылся бы Safari со своим отдельным хранилищем. Поэтому — через буфер.",
        steps: [
            { set: `Новая команда: «+» → «Переименовать» → <code>${SHORTCUT_SIRI}</code>. Это же название слушает Siri.` },
            { find: "продиктовать", name: "Продиктовать текст", block: "Продиктовать текст" },
            { find: "скопировать", name: "Скопировать в буфер обмена", block: "Скопировать [Продиктованный текст] в буфер обмена" },
            { find: "уведомление", name: "Показать уведомление", block: "Показать уведомление [Записал. Открой План — он предложит вставить]", set: "Текст: <code>Записал. Открой План — он предложит вставить</code>." },
            { set: `Проверь: «Привет, Siri, ${SHORTCUT_SIRI.toLowerCase()}» → «завтра в 10 позвонить в банк» → открой План → «Вставить» в подсказке внизу.` }
        ]
    },
    {
        id: "rituals", title: "4. Ритуалы — отдельный список", intro: "Утро, вечер и бэкап — обычные повторяющиеся напоминания. Создаются один раз и звонят сами, а список «План» остаётся только для задач.",
        steps: [
            { set: "«Напоминания» → внизу «Добавить список» → назови <code>Ритуалы</code>." },
            { set: `Новое напоминание в «Ритуалах»: <code>Утро: посмотри план на день</code>. Кнопка <b>ⓘ</b> → включи <b>Дата</b> и <b>Время</b> → <code>${state.settings.morning}</code> → <b>Повтор</b> → <b>Ежедневно</b>.` },
            { set: `Ещё одно: <code>Вечер: ${state.settings.dumpMin} минут выгрузить из головы</code> → время <code>${state.settings.evening}</code> → <b>Повтор</b> → <b>Ежедневно</b>.` },
            { set: `И бэкап: <code>Бэкап плана: Ещё → Сохранить бэкап</code> → дата — ближайшее воскресенье, время <code>${shiftTime(state.settings.evening, 5)}</code> → <b>Повтор</b> → <b>Еженедельно</b>.` },
            { set: "Отправь план («Ещё → Только отправить»): старые утро и вечер исчезнут из списка «План».",
                alt: "Поменял время утра или вечера в «Ещё → День и ритуалы» — поправь и здесь, в «Ритуалах»: сами они не обновятся." }
        ]
    },
    {
        id: "widget", title: "5. План на экране блокировки", intro: "Приложение с экрана «Домой» не умеет виджеты, а Напоминания умеют.",
        steps: [
            { set: "Долгое нажатие на экран блокировки → «Настроить» → экран блокировки → «Добавить виджеты» → <b>Напоминания</b> → список <i>План</i>. В виджете будут только задачи: ритуалы в другом списке." },
            { set: "По желанию так же на экран «Домой»." }
        ]
    }
];

// [поле] → синее поле, как в редакторе команд
// «20:00» + 5 минут → «20:05»
function shiftTime(time, minutes) {
    const [h, m] = time.split(":").map(Number);
    const total = (h * 60 + m + minutes) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const blockHtml = text => text.replace(/\[([^\]]+)\]/g, '<span class="g-var">$1</span>');

function stepHtml(step) {
    return [
        step.find ? `<span class="g-line"><span class="g-tag">Поиск</span><code>${step.find}</code> → <b>${step.name}</b></span>` : "",
        step.block ? `<span class="g-line"><span class="g-tag">Блок</span><span class="g-block">${blockHtml(step.block)}</span></span>` : "",
        step.set ? `<span class="g-line">${step.set}</span>` : ""
    ].join("");
}

const HELP = `
    <details id="help"><summary>Напоминание не пришло</summary>
        <ol>
            <li>Открой «Напоминания» → список <i>План</i>. Есть «Проверка Плана»? Если нет — команда не запустилась или называется не точно «${SHORTCUT_SEND}».</li>
            <li>Есть, но без времени — в «Добавить напоминание» осталось «Без предупреждения»: нажми его и выбери время — «Даты».</li>
            <li>Есть со временем, но тихо — Настройки → Уведомления → Напоминания: разрешены ли уведомления; не включён ли режим фокусировки.</li>
            <li>Команда спрашивает про удаление — см. шаг 0.</li>
            <li>Ошибка «словарь» или «значение» — проверь, что команда начинается с «Получить буфер обмена», а ключ написан латиницей: reminders.</li>
        </ol>
    </details>`;

export async function guideSheet(open = null) {
    const checks = (await getMeta("guideChecks2")) || {};
    const GUIDE = guideParts();
    const { sheet, close } = openSheet(`
        <div class="sheet-body guide">
            <h2>Быстрые команды</h2>
            <p class="text-2">Собери по шагам и ставь галочки — прогресс сохранится. Минут 15. Потом «Тест: напоминание через 2 минуты».</p>
            <p class="text-2">Всё <code>жёлтое</code> — нажми, и оно скопируется. Потом вставь в поле команды.</p>
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
                    ${SHORTCUT_LINKS[part.id] ? `
                        <a class="btn primary wide" href="${esc(SHORTCUT_LINKS[part.id])}" target="_blank" rel="noopener">Добавить команду одним нажатием</a>
                        <p class="text-2">Откроются Быстрые команды → «Добавить команду». Вручную собирать не нужно, шаги ниже — на случай, если ссылка не сработает.</p>` : ""}
                    ${part.steps.map((step, i) => `
                        <div class="guide-step">
                            <label><input type="checkbox" data-check="${part.id}-${i}" ${checks[`${part.id}-${i}`] ? "checked" : ""}><span class="g-body">${stepHtml(step)}</span></label>
                            ${step.alt ? `<details class="alt"><summary>Не получается?</summary><p>${step.alt}</p></details>` : ""}
                        </div>`).join("")}
                </details>`;
        }).join("");
    };
    render();

    // жёлтое (code) — то, что вставляется в команду: касание копирует
    sheet.querySelector("#guideParts").addEventListener("click", event => {
        const code = event.target.closest("code");
        if (!code) {
            return;
        }
        event.preventDefault();
        const text = code.textContent;
        navigator.clipboard.writeText(text).then(() => {
            haptic();
            code.classList.add("copied");
            setTimeout(() => code.classList.remove("copied"), 900);
            showToast(`Скопировано: ${text}`);
        }, () => showToast("Не получилось скопировать"));
    });

    sheet.querySelector("#guideParts").addEventListener("change", event => {
        const key = event.target.dataset.check;
        if (!key) {
            return;
        }
        haptic();
        checks[key] = event.target.checked;
        setMeta("guideChecks2", checks);
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
