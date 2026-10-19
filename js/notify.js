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
            setMeta("remindersOk", true).then(refreshMore);
            showToast("Отлично: напоминания приходят");
            break;
        case "testNo":
            guideSheet("help");
            break;
    }
    return true;
}

function send(items = reminderItems()) {
    sendToReminders(items).catch(() => showToast("Не получилось положить в буфер. Попробуй ещё раз."));
}

async function test() {
    const at = new Date(Date.now() + 2 * 60000);
    // тест едет вместе с настоящими напоминаниями: команда заменяет все напоминания плана
    send([...reminderItems(), { key: "plan:test:1", title: "Проверка Плана", due: toIso(at), notes: "plan:test:1" }]);
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

// ---- инструкция ----
const GUIDE = `
    <h2>Быстрые команды</h2>
    <p class="text-2">Собрать один раз, минут 15. Названия действий — как в&nbsp;iOS на&nbsp;русском; в&nbsp;разных версиях могут чуть отличаться. Действие ищется поиском внизу экрана команды.</p>

    <details open><summary>0. Подготовка</summary>
        <ol>
            <li>В&nbsp;«Напоминаниях» создай список <b>План</b>.</li>
            <li>Настройки → Приложения → Быстрые команды → Дополнения: включи <b>«Разрешить удаление без подтверждения»</b>. Иначе команда каждый раз спросит, можно&nbsp;ли удалить старые напоминания.</li>
        </ol>
    </details>

    <details><summary>1. «${SHORTCUT_SEND}»</summary>
        <p class="text-2">Удаляет открытые напоминания плана и&nbsp;создаёт присланные. Название — точно <b>${SHORTCUT_SEND}</b>, с&nbsp;двоеточием.</p>
        <ol>
            <li><b>Получить буфер обмена</b>.</li>
            <li><b>Получить словарь из входных данных</b> — из «Буфер обмена».</li>
            <li><b>Получить значение словаря</b>: «Значение» для ключа <code>reminders</code> в «Словарь».</li>
            <li><b>Найти напоминания</b>: «Добавить фильтр» → <i>Заметки</i> <i>содержат</i> <code>plan:</code>; ещё фильтр → <i>Выполнено</i> — <i>нет</i>.</li>
            <li><b>Удалить напоминания</b> — «Напоминания» из шага&nbsp;4.</li>
            <li><b>Повторить с каждым</b> — «Значение словаря» из шага&nbsp;3. Внутри повтора:
                <ol type="a">
                    <li><b>Получить значение словаря</b>: ключ <code>title</code> в «Повторяемый объект». Нажми на результат → «Переименовать» → <i>Название</i>.</li>
                    <li>Так&nbsp;же ключ <code>due</code> → переименуй в <i>Срок</i>.</li>
                    <li>Так&nbsp;же ключ <code>notes</code> → переименуй в <i>Заметки</i>.</li>
                    <li><b>Получить даты из входных данных</b> — из «Срок».</li>
                    <li><b>Добавить новое напоминание</b>: текст — «Название», список — <i>План</i>. Раскрой стрелку: включи <i>Напомнить</i>, дата — «Даты»; заметки — «Заметки».</li>
                </ol>
            </li>
            <li>После «Конец повтора»: <b>Показать уведомление</b> «Напоминания обновлены» (по&nbsp;желанию).</li>
        </ol>
        <p class="text-2">Общий список. Если у&nbsp;списка в&nbsp;«Ещё → Списки» включено «Общий», его задачи приходят с&nbsp;ключом <code>list</code>. Внутри повтора перед шагом «e» добавь «Получить значение словаря» <code>list</code>, затем <b>Если</b> «содержит» название списка: «Добавить новое напоминание» в&nbsp;этот общий список, «Иначе» — в&nbsp;<i>План</i>.</p>
    </details>

    <details><summary>2. «${SHORTCUT_SYNC}»</summary>
        <p class="text-2">Собирает отмеченное в&nbsp;Напоминаниях и&nbsp;кладёт в&nbsp;буфер.</p>
        <ol>
            <li><b>Найти напоминания</b>: фильтр <i>Заметки</i> <i>содержат</i> <code>plan:</code>.</li>
            <li><b>Повторить с каждым</b> — «Напоминания». Внутри:
                <ol type="a">
                    <li><b>Получить сведения о напоминаниях</b>: <i>Заметки</i> из «Повторяемый объект».</li>
                    <li><b>Сопоставить текст</b>: шаблон <code>plan:[A-Za-z0-9_@-]+:\\d</code> в «Заметки».</li>
                    <li><b>Получить сведения о напоминаниях</b>: <i>Выполнено</i> из «Повторяемый объект».</li>
                    <li><b>Получить сведения о напоминаниях</b>: <i>Дата исполнения</i> (срок) из «Повторяемый объект».</li>
                    <li><b>Форматировать дату</b> «Дата исполнения»: формат <i>ISO 8601</i>, включить время.</li>
                    <li><b>Текст</b>: <code>Совпадения|Выполнено|Отформатированная дата</code> — вместо слов вставь эти переменные, между ними вертикальная черта.</li>
                </ol>
            </li>
            <li>После «Конец повтора»: <b>Объединить текст</b> «Результаты повтора» через <i>Новые строки</i>.</li>
            <li><b>Скопировать в буфер обмена</b>.</li>
            <li><b>Показать уведомление</b>: «Сверка готова, вернись в План».</li>
        </ol>
    </details>

    <details><summary>3. Siri: «${SHORTCUT_SIRI}»</summary>
        <ol>
            <li><b>Диктовать текст</b>.</li>
            <li><b>Скопировать в буфер обмена</b>.</li>
            <li><b>Показать уведомление</b>: «Записал. Открой План — он предложит вставить».</li>
        </ol>
        <p class="text-2">Говоришь «Привет, Siri, ${SHORTCUT_SIRI.toLowerCase()}», диктуешь «завтра в 10 позвонить в банк». Открываешь План и&nbsp;нажимаешь «Вставить» в&nbsp;подсказке внизу: фраза разберётся, как в&nbsp;быстром вводе. Сразу в&nbsp;приложение команда записать не может: по&nbsp;ссылке открылся&nbsp;бы Safari со своим отдельным хранилищем.</p>
    </details>

    <details><summary>4. План на экране блокировки</summary>
        <p class="text-2">Приложение с&nbsp;экрана «Домой» не&nbsp;умеет виджеты, а&nbsp;Напоминания умеют. Долгое нажатие на&nbsp;экран блокировки → «Настроить» → экран блокировки → «Добавить виджеты» → <b>Напоминания</b> → список <i>План</i>. Так&nbsp;же можно поставить на&nbsp;экран «Домой».</p>
    </details>

    <details id="help"><summary>Напоминание не пришло</summary>
        <ol>
            <li>Открой «Напоминания» → список <i>План</i>. Есть «Проверка Плана»? Если нет — команда не&nbsp;запустилась или называется не&nbsp;точно «${SHORTCUT_SEND}».</li>
            <li>Есть, но без времени — в&nbsp;шаге «Добавить новое напоминание» не&nbsp;включено <i>Напомнить</i> или дата не&nbsp;«Даты».</li>
            <li>Есть со временем, но тихо — Настройки → Уведомления → Напоминания: разрешены ли уведомления; не&nbsp;включён&nbsp;ли режим фокусировки.</li>
            <li>Команда спрашивает про удаление — см. шаг&nbsp;0.</li>
        </ol>
    </details>`;

export function guideSheet(open = null) {
    const { sheet, close } = openSheet(`
        <div class="sheet-body guide">${GUIDE}</div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`);
    sheet.classList.add("tall");
    if (open) {
        const section = sheet.querySelector("#" + open);
        section.open = true;
        requestAnimationFrame(() => section.scrollIntoView());
    }
    sheet.querySelector("[data-close]").addEventListener("click", close);
}
