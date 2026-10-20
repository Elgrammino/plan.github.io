// Настройки во вкладке «Ещё»: день и ритуалы, перенос, списки, шаблоны чек-листов, корзина.
// И журнал сделанного по дням.
import { addDays, dayKey, durationText, parseDate, plural, relativeDay, timeText } from "./dates.js";
import { parseLine } from "./chains.js";
import { openOnboarding, resetHints } from "./onboarding.js";
import { startTutorial } from "./tutorial.js";
import { repeatText } from "./repeat.js";
import { editTask } from "./sheets.js";
import {
    POSTPONE, doneByDay, listName, onChange, postponed, purgeTasks, putTasks, restoreTask, saveSettings,
    saveChains, saveTemplates, setLists, state, trashedTasks
} from "./store.js";
import { esc, escTitle, haptic, ICONS, openSheet, showToast } from "./ui.js";

const DUMP_LENGTHS = [5, 10, 15, 25];

// ---- строки в «Ещё» ----
export function settingsRows() {
    const today = doneByDay(0).find(group => group.day === dayKey(new Date()))?.tasks.length || 0;
    const trash = trashedTasks().length;
    const row = (key, title, value = "") => `
        <button class="batch-row" data-settings="${key}">
            <span class="what">${title}</span>
            <span class="text-2">${value}</span>
        </button>`;
    return `
        <div class="card">
            ${row("journal", "Журнал сделанного", today ? `сегодня <span class="mono">${today}</span>` : "")}
            ${row("day", "День и&nbsp;ритуалы", `<span class="mono">${durationText(state.settings.dayLimitMin)}</span>`)}
            ${row("postpone", "Варианты переноса", `<span class="mono">${state.settings.postpone.length}</span>`)}
            ${row("lists", "Списки", `<span class="mono">${state.lists.length}</span>`)}
            ${row("templates", "Шаблоны чек-листов", `<span class="mono">${state.templates.length}</span>`)}
            ${row("chains", "Шаблоны цепочек", `<span class="mono">${state.chains.length}</span>`)}
            ${row("trash", "Корзина", trash ? `<span class="mono">${trash}</span>` : "пусто")}
            ${row("tutorial", "Обучение по&nbsp;приложению", "17 шагов")}
            ${row("onboarding", "Знакомство с&nbsp;приложением", "заново")}
        </div>`;
}

export function openSettings(key) {
    if (key === "tutorial") {
        startTutorial();
        return;
    }
    if (key === "onboarding") {
        resetHints();
        openOnboarding(null, "intro-0");
        return;
    }
    ({ journal: journalSheet, day: daySheet, postpone: postponeSheet, lists: listsSheet, templates: templatesSheet, chains: chainsSheet, trash: trashSheet })[key]?.();
}

// ---- день и ритуалы ----
function daySheet() {
    const settings = state.settings;
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>День и&nbsp;ритуалы</h2>
            <div class="field"><div class="label">Лимит часов в&nbsp;день</div>
                <div class="row">
                    <input class="input every" type="number" inputmode="decimal" min="1" max="16" step="0.5" id="limit" value="${settings.dayLimitMin / 60}">
                    <span class="text-2">ч&nbsp;— больше полоса дня краснеет</span>
                </div>
            </div>
            <div class="field"><div class="label">Ритуалы</div>
                <div class="row"><span class="text-2 row-label">Утро</span><input class="input" type="time" id="morning" value="${settings.morning}"></div>
                <div class="row" style="margin-top: var(--sp-8)"><span class="text-2 row-label">Вечер</span><input class="input" type="time" id="evening" value="${settings.evening}"></div>
                <p class="hint" style="margin-top: var(--sp-8)">С&nbsp;вечернего времени «Сегодня» зовёт на&nbsp;выгрузку. Напоминания придут, когда подключим Быстрые команды.</p>
            </div>
            <div class="field"><div class="label">Выгрузка из&nbsp;головы, минут</div>
                <div class="chips">${DUMP_LENGTHS.map(min => `
                    <label class="chip"><input type="radio" name="dumpMin" value="${min}" ${min === settings.dumpMin ? "checked" : ""}><span class="mono">${min}</span></label>`).join("")}
                </div>
            </div>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`, { onClose: save });
    const $ = selector => sheet.querySelector(selector);
    sheet.querySelector("[data-close]").addEventListener("click", close);

    function save() {
        const hours = Math.min(16, Math.max(1, +$("#limit").value || settings.dayLimitMin / 60));
        settings.dayLimitMin = Math.round(hours * 2) * 30; // шаг полчаса
        settings.morning = $("#morning").value || settings.morning;
        settings.evening = $("#evening").value || settings.evening;
        settings.dumpMin = +sheet.querySelector('input[name="dumpMin"]:checked').value;
        saveSettings();
    }
}

// ---- перенос ----
function postponeSheet() {
    const settings = state.settings;
    const sample = { plannedAt: null };
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Варианты переноса</h2>
            <p class="hint">Что показывать в&nbsp;шторке «Перенести» и&nbsp;при свайпе влево.</p>
            <div class="field" id="options">${POSTPONE.map(option => `
                <label class="toggle"><span>${option.label}<small class="mono" data-when="${option.id}"></small></span>
                    <input type="checkbox" switch value="${option.id}" ${settings.postpone.includes(option.id) ? "checked" : ""}></label>`).join("")}
            </div>
            <div class="field"><div class="label">Время</div>
                <div class="row"><span class="text-2 row-label">Вечером</span><input class="input" type="time" id="postponeEvening" value="${settings.postponeEvening}"></div>
                <div class="row" style="margin-top: var(--sp-8)"><span class="text-2 row-label">Утром</span><input class="input" type="time" id="postponeMorning" value="${settings.postponeMorning}"></div>
                <div class="row" style="margin-top: var(--sp-8)"><span class="text-2 row-label">В&nbsp;выходные</span><input class="input" type="time" id="postponeWeekend" value="${settings.postponeWeekend}"></div>
            </div>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`, { onClose: save });
    const $ = selector => sheet.querySelector(selector);

    // рядом с каждым вариантом — куда он перенесёт задачу прямо сейчас
    const preview = () => {
        read();
        sheet.querySelectorAll("[data-when]").forEach(el => {
            const at = postponed(sample, el.dataset.when);
            el.textContent = `${relativeDay(at)} ${timeText(at)}`;
        });
    };
    function read() {
        ["postponeEvening", "postponeMorning", "postponeWeekend"].forEach(key => settings[key] = $("#" + key).value || settings[key]);
        const chosen = [...sheet.querySelectorAll("#options input:checked")].map(input => input.value);
        settings.postpone = chosen.length ? chosen : ["tomorrow"]; // хотя бы один вариант
    }
    function save() {
        read();
        saveSettings();
    }
    sheet.addEventListener("change", preview);
    sheet.querySelector("[data-close]").addEventListener("click", close);
    preview();
}

// ---- списки ----
function listsSheet() {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Списки</h2>
            <div id="lists"></div>
            <div class="row" style="margin-top: var(--sp-16)">
                <input class="input" id="newList" enterkeyhint="done" placeholder="Новый список" autocomplete="off">
                <button class="btn ghost" id="addList">Добавить</button>
            </div>
            <p class="hint" style="margin-top: var(--sp-12)">«Общий» — задачи уйдут в&nbsp;общий список Напоминаний iCloud с&nbsp;таким&nbsp;же названием. Заработает вместе с&nbsp;Быстрыми командами.</p>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`);
    const $ = selector => sheet.querySelector(selector);
    const count = id => [...state.tasks.values()].filter(task => task.list === id && !task.deletedAt && !task.done).length;

    const render = () => {
        $("#lists").innerHTML = state.lists.map((list, i) => `
            <div class="list-row" data-list="${list.id}">
                <input class="input" value="${esc(list.name)}" data-rename aria-label="Название">
                <button class="icon-btn" data-move="-1" aria-label="Выше" ${i === 0 ? "disabled" : ""}>${ICONS.up}</button>
                <button class="icon-btn" data-move="1" aria-label="Ниже" ${i === state.lists.length - 1 ? "disabled" : ""}>${ICONS.down}</button>
                <button class="icon-btn" data-remove aria-label="Удалить">${ICONS.trash}</button>
                <label class="toggle list-shared"><span>Общий<small>${count(list.id)} в&nbsp;работе</small></span>
                    <input type="checkbox" switch data-shared ${list.shared ? "checked" : ""}></label>
            </div>`).join("");
    };
    const renumber = lists => lists.map((list, i) => ({ ...list, order: i + 1 }));

    $("#lists").addEventListener("change", event => {
        const id = event.target.closest("[data-list]").dataset.list;
        const lists = state.lists.map(list => ({ ...list }));
        const list = lists.find(item => item.id === id);
        if (event.target.matches("[data-rename]")) {
            const name = event.target.value.trim();
            if (!name || lists.some(item => item !== list && item.name.toLowerCase() === name.toLowerCase())) {
                event.target.value = list.name; // пустое и повтор не принимаем
                showToast(name ? "Такой список уже есть" : "Название не может быть пустым");
                return;
            }
            list.name = name;
        } else if (event.target.matches("[data-shared]")) {
            list.shared = event.target.checked;
        }
        setLists(lists);
    });
    $("#lists").addEventListener("click", async event => {
        const button = event.target.closest("[data-move], [data-remove]");
        if (!button) {
            return;
        }
        haptic();
        const id = button.closest("[data-list]").dataset.list;
        const lists = state.lists.map(list => ({ ...list }));
        const index = lists.findIndex(list => list.id === id);
        if (button.dataset.move) {
            const [list] = lists.splice(index, 1);
            lists.splice(index + +button.dataset.move, 0, list);
            await setLists(renumber(lists));
            render();
            return;
        }
        // удаление: задачи остаются, только без списка; «Вернуть» всё возвращает
        const [removed] = lists.splice(index, 1);
        const tasks = [...state.tasks.values()].filter(task => task.list === id);
        await setLists(renumber(lists));
        await putTasks(tasks.map(task => ({ ...task, list: null })));
        render();
        showToast(`Список «${removed.name}» удалён`, "Вернуть", async () => {
            const back = state.lists.map(list => ({ ...list }));
            back.splice(index, 0, removed);
            await setLists(renumber(back));
            await putTasks(tasks);
            render();
        });
    });

    const add = () => {
        const name = $("#newList").value.trim();
        if (!name) {
            $("#newList").focus();
            return;
        }
        if (state.lists.some(list => list.name.toLowerCase() === name.toLowerCase())) {
            showToast("Такой список уже есть");
            return;
        }
        haptic();
        setLists([...state.lists, { id: "l-" + crypto.randomUUID().slice(0, 6), name, order: state.lists.length + 1, shared: false }]);
        $("#newList").value = "";
        render();
    };
    $("#addList").addEventListener("click", add);
    $("#newList").addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            add();
        }
    });
    sheet.querySelector("[data-close]").addEventListener("click", close);
    render();
}

// ---- шаблоны чек-листов ----
function templatesSheet() {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Шаблоны чек-листов</h2>
            <p class="hint">Один раз собрал — дальше подставляешь в&nbsp;задачу кнопкой в&nbsp;блоке «Шаги».</p>
            <div id="templates"></div>
            <button class="btn ghost wide" id="newTemplate" style="margin-top: var(--sp-16)">Новый шаблон</button>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`);
    const render = () => {
        sheet.querySelector("#templates").innerHTML = state.templates.map(template => `
            <button class="batch-row" data-template="${template.id}">
                <span class="what">${esc(template.name)}</span>
                <span class="mono text-2">${template.steps.length}</span>
            </button>`).join("") || `<p class="text-2">Шаблонов пока нет.</p>`;
    };
    sheet.querySelector("#templates").addEventListener("click", event => {
        const id = event.target.closest("[data-template]")?.dataset.template;
        if (id) {
            editTemplate(state.templates.find(template => template.id === id), render);
        }
    });
    sheet.querySelector("#newTemplate").addEventListener("click", () => editTemplate(null, render));
    sheet.querySelector("[data-close]").addEventListener("click", close);
    render();
}

// template = null — новый; prefill — начальные название и шаги для нового (из карточки задачи)
export function editTemplate(template, onDone = () => { }, prefill = null) {
    const start = template || prefill;
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <input class="input" id="tplName" placeholder="Название, например «Сборы: корпоратив»" value="${esc(start?.name || "")}" autocomplete="off">
            <div class="field"><div class="label">Шаги, по&nbsp;одному в&nbsp;строке</div>
                <textarea class="textarea" id="tplSteps" rows="8" placeholder="Костюм&#10;Реквизит&#10;Колонка заряжена">${esc(start?.steps.join("\n") || "")}</textarea>
            </div>
        </div>
        <div class="sheet-foot">
            ${template ? `<button class="icon-btn" id="tplDelete" aria-label="Удалить">${ICONS.trash}</button>` : ""}
            <button class="btn ghost grow" data-close>Отмена</button>
            <button class="btn primary grow" id="tplSave">Сохранить</button>
        </div>`);
    const $ = selector => sheet.querySelector(selector);
    if (!template) {
        $("#tplName").focus();
    }
    sheet.querySelector("[data-close]").addEventListener("click", close);
    $("#tplSave").addEventListener("click", () => {
        const name = $("#tplName").value.trim();
        const steps = $("#tplSteps").value.split("\n").map(step => step.trim()).filter(Boolean);
        if (!name || !steps.length) {
            showToast(name ? "Добавь хотя бы один шаг" : "Дай шаблону название");
            return;
        }
        haptic();
        if (template) {
            Object.assign(template, { name, steps });
        } else {
            state.templates.push({ id: "tpl-" + crypto.randomUUID().slice(0, 6), name, steps });
        }
        saveTemplates();
        close();
        onDone();
    });
    $("#tplDelete")?.addEventListener("click", () => {
        haptic();
        const index = state.templates.indexOf(template);
        state.templates.splice(index, 1);
        saveTemplates();
        close();
        onDone();
        showToast(`Шаблон «${template.name}» удалён`, "Вернуть", () => {
            state.templates.splice(index, 0, template);
            saveTemplates();
            onDone();
        });
    });
}

// ---- шаблоны цепочек ----
function chainsSheet() {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Шаблоны цепочек</h2>
            <p class="hint">От&nbsp;главной задачи (публикация, выступление) сами считаются шаги. Подключаются в&nbsp;карточке задачи, блок «Цепочка».</p>
            <div id="chains"></div>
            <button class="btn ghost wide" id="newChain" style="margin-top: var(--sp-16)">Новый шаблон</button>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`);
    const render = () => {
        sheet.querySelector("#chains").innerHTML = state.chains.map(chain => `
            <button class="batch-row" data-chain="${chain.id}">
                <span class="what">${esc(chain.name)}</span>
                <span class="mono text-2">${chain.lines.length}</span>
            </button>`).join("") || `<p class="text-2">Шаблонов пока нет.</p>`;
    };
    sheet.querySelector("#chains").addEventListener("click", event => {
        const id = event.target.closest("[data-chain]")?.dataset.chain;
        if (id) {
            editChain(state.chains.find(chain => chain.id === id), render);
        }
    });
    sheet.querySelector("#newChain").addEventListener("click", () => editChain(null, render));
    sheet.querySelector("[data-close]").addEventListener("click", close);
    render();
}

function editChain(chain, onDone) {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <input class="input" id="chainName" placeholder="Название, например «Публикация»" value="${esc(chain?.name || "")}" autocomplete="off">
            <div class="field"><div class="label">Шаги, по&nbsp;одному в&nbsp;строке</div>
                <textarea class="textarea mono-area" id="chainLines" rows="6" placeholder="-2д 12:00 Снять: {title} 1ч">${esc(chain?.lines.join("\n") || "")}</textarea>
                <div class="preview" id="chainCheck"></div>
            </div>
            <div class="hint chain-help">
                Строка: <b>сдвиг</b> [время] <b>название</b> [длительность].<br>
                <code>-2д 12:00 Снять: {title} 1ч</code> — за&nbsp;два дня в&nbsp;12:00<br>
                <code>-3ч Подпись: {title} 15м</code> — за&nbsp;три часа до&nbsp;начала<br>
                <code>-дорога Выезд: {title} дорога</code> — за&nbsp;время в&nbsp;пути<br>
                <code>+2ч После: {title} 30м</code> — через два часа после начала<br>
                {title} — название главной задачи. Шаг «Сборы…» получает чек-лист.
            </div>
        </div>
        <div class="sheet-foot">
            ${chain ? `<button class="icon-btn" id="chainDelete" aria-label="Удалить">${ICONS.trash}</button>` : ""}
            <button class="btn ghost grow" data-close>Отмена</button>
            <button class="btn primary grow" id="chainSave">Сохранить</button>
        </div>`);
    const $ = selector => sheet.querySelector(selector);
    const lines = () => $("#chainLines").value.split("\n").map(line => line.trim()).filter(Boolean);
    // какие строки не разобрались — видно сразу
    const check = () => {
        const bad = lines().filter(line => !parseLine(line));
        $("#chainCheck").textContent = bad.length ? `Не понял: ${bad.join("; ")}` : lines().length ? `Шагов: ${lines().length}` : "";
    };
    $("#chainLines").addEventListener("input", check);
    check();
    sheet.querySelector("[data-close]").addEventListener("click", close);
    $("#chainSave").addEventListener("click", () => {
        const name = $("#chainName").value.trim();
        const good = lines().filter(line => parseLine(line));
        if (!name || !good.length) {
            showToast(name ? "Нужен хотя бы один понятный шаг" : "Дай шаблону название");
            return;
        }
        haptic();
        if (chain) {
            Object.assign(chain, { name, lines: good });
        } else {
            state.chains.push({ id: "chain-" + crypto.randomUUID().slice(0, 6), name, lines: good });
        }
        saveChains();
        close();
        onDone();
    });
    $("#chainDelete")?.addEventListener("click", () => {
        haptic();
        const index = state.chains.indexOf(chain);
        state.chains.splice(index, 1);
        saveChains();
        close();
        onDone();
        showToast(`Шаблон «${chain.name}» удалён`, "Вернуть", () => {
            state.chains.splice(index, 0, chain);
            saveChains();
            onDone();
        });
    });
}

// ---- корзина ----
function trashSheet() {
    let confirmPurge = false;
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Корзина</h2>
            <p class="hint">Удалённое хранится 30&nbsp;дней, потом стирается само.</p>
            <div id="trash"></div>
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" id="purge">Очистить</button>
            <button class="btn primary grow" data-close>Готово</button>
        </div>`);
    sheet.classList.add("tall");
    const render = () => {
        const tasks = trashedTasks();
        sheet.querySelector("#trash").innerHTML = tasks.map(task => {
            const left = 30 - Math.floor((Date.now() - parseDate(task.deletedAt)) / 86400000);
            return `
                <div class="item" data-id="${task.id}">
                    <div class="body">
                        <div class="name">${escTitle(task.title)}</div>
                        <div class="sub">удалено ${esc(relativeDay(task.deletedAt))} · сотрётся через ${left} ${plural(left, "день", "дня", "дней")}</div>
                    </div>
                    <button class="chip-btn side" data-restore>Вернуть</button>
                </div>`;
        }).join("") || `<p class="search-empty">Пусто.</p>`;
        sheet.querySelector("#purge").hidden = !tasks.length;
    };
    sheet.querySelector("#trash").addEventListener("click", event => {
        const id = event.target.closest("[data-restore]") && event.target.closest("[data-id]").dataset.id;
        if (id) {
            haptic();
            restoreTask(state.tasks.get(id));
            render();
        }
    });
    // «Очистить» стирает навсегда, поэтому спрашивает второй раз
    sheet.querySelector("#purge").addEventListener("click", async event => {
        haptic();
        if (!confirmPurge) {
            confirmPurge = true;
            event.target.textContent = `Стереть навсегда: ${trashedTasks().length}`;
            return;
        }
        await purgeTasks(trashedTasks());
        render();
    });
    sheet.querySelector("[data-close]").addEventListener("click", close);
    render();
}

// ---- журнал сделанного ----
export function journalSheet() {
    let unsubscribe = () => { };
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Сделано</h2>
            <div id="journal"></div>
        </div>
        <div class="sheet-foot"><button class="btn primary grow" data-close>Готово</button></div>`,
        { onClose: () => unsubscribe() });
    sheet.classList.add("tall");

    const render = () => {
        const now = new Date();
        const groups = doneByDay(60, now);
        const since = days => groups.filter(group => group.day > dayKey(addDays(now, -days))).reduce((sum, group) => sum + group.tasks.length, 0);
        const totals = `
            <div class="journal-sum">
                <div><span class="mono">${since(1)}</span><small>сегодня</small></div>
                <div><span class="mono">${since(7)}</span><small>за&nbsp;7 дней</small></div>
                <div><span class="mono">${since(30)}</span><small>за&nbsp;30 дней</small></div>
            </div>`;
        sheet.querySelector("#journal").innerHTML = totals + (groups.length ? groups.map(({ day, tasks }) => {
            const minutes = tasks.reduce((sum, task) => sum + (task.durationMin || 0), 0);
            const date = parseDate(day).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
            const rel = relativeDay(day);
            const head = ["сегодня", "вчера"].includes(rel) ? `${rel.charAt(0).toUpperCase() + rel.slice(1)}, ${date}` : date;
            return `
                <div class="label journal-day"><span>${esc(head)}</span><span class="mono">${tasks.length}${minutes ? " · " + durationText(minutes) : ""}</span></div>
                ${tasks.map(task => `
                    <button class="result" data-id="${task.id}">
                        <div class="name">${escTitle(task.title)}</div>
                        <div class="sub">${[timeText(task.doneAt), listName(task.list), task.durationMin && durationText(task.durationMin), task.repeat && "↻ " + repeatText(task.repeat)].filter(Boolean).map(esc).join(" · ")}</div>
                    </button>`).join("")}`;
        }).join("") : `<p class="search-empty">Пока ничего не&nbsp;отмечено. Отмеченные задачи соберутся здесь по&nbsp;дням.</p>`);
    };
    // правка задачи из журнала сразу видна
    unsubscribe = onChange(render);
    sheet.querySelector("#journal").addEventListener("click", event => {
        const task = state.tasks.get(event.target.closest("[data-id]")?.dataset.id);
        if (task) {
            editTask(task);
        }
    });
    sheet.querySelector("[data-close]").addEventListener("click", close);
    render();
}
