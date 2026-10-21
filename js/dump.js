// Выгрузка из головы: таймер и одно поле для мыслей, потом колода карточек.
// Черновик живёт в базе (state.dump), поэтому закрытое приложение ничего не теряет.
import { durationText, hasTime, plural, relativeDay, timeText } from "./dates.js";
import { editTask } from "./sheets.js";
import { sortThought, splitThoughts } from "./sort.js";
import { discardTask, finishDump, listName, newTask, saveDump, saveSettings, saveTask, state } from "./store.js";
import { openMatrix } from "./matrix.js";
import { esc, haptic, ICONS, lockScroll, showToast, unlockScroll } from "./ui.js";

const LENGTHS = [5, 10, 15, 25];
const HINT_EVERY = 120; // секунд: новая тема раз в 2 минуты…
const HINT_QUIET = 5000; // …но не под пальцами: ждём 5 секунд тишины после набора

const HINTS = [
    "Что крутится в голове прямо сейчас?",
    "Выступления и заказы: кто ждёт ответа, что с договорами и предоплатами?",
    "Реквизит: что сломалось, закончилось, что докупить или сделать?",
    "Instagram: идеи, рилсы, сторис, ответы в директ?",
    "Дом и семья: что сломано, кому позвонить, что пообещано?",
    "Деньги и документы: счета, налоги, оплаты, подписи?",
    "Что висит дольше месяца и всё время откладывается?",
    "Здоровье: врачи, спорт, лекарства?",
    "Что купить?",
    "Что тревожит, даже если непонятно, что с этим делать?"
];

const ENERGY_DOTS = { low: "●", mid: "●●", high: "●●●" };

let root = null;
let tick = null;
let wakeLock = null;
let onDone = null;

// done(screen): после выгрузки открыть вкладку, например «Входящие»
// minutes: начать сразу на столько минут, без стартового экрана (онбординг)
export function openDump(done, minutes = null) {
    onDone = done;
    const dump = state.dump;
    if (!dump && minutes) {
        begin(minutes);
    } else if (!dump) {
        startScreen();
    } else if (dump.phase === "write") {
        writeScreen();
    } else if (dump.cards.length) {
        sortScreen();
    } else if (dump.phase === "matrix") {
        matrixStep();
    } else {
        summaryScreen();
    }
}

function mount(html) {
    clearInterval(tick);
    if (!root) {
        root = document.createElement("div");
        root.className = "dump";
        root.setAttribute("role", "dialog");
        document.body.append(root);
        lockScroll();
    }
    root.innerHTML = html;
    root.querySelector("[data-close]")?.addEventListener("click", unmount);
    return selector => root.querySelector(selector);
}

function unmount() {
    clearInterval(tick);
    wakeLock?.release().catch(() => { });
    wakeLock = null;
    root?.remove();
    root = null;
    unlockScroll();
}

// ---- 1. старт ----
function startScreen() {
    const $ = mount(`
        <div class="dump-top">
            <button class="icon-btn" data-close aria-label="Закрыть">${ICONS.close}</button>
        </div>
        <h1 class="title">Выгрузка из&nbsp;головы</h1>
        <p class="subtitle">Пиши всё, что крутится в&nbsp;голове: дела, идеи, тревоги. По&nbsp;одной мысли, без разбора. Разложим потом.</p>
        <div class="label">Сколько минут</div>
        <div class="chips">${LENGTHS.map(min => `
            <label class="chip"><input type="radio" name="length" value="${min}" ${min === state.settings.dumpMin ? "checked" : ""}><span class="mono">${min}</span></label>`).join("")}
        </div>
        <button class="btn primary wide dump-go" id="go">Начать</button>`);

    $("#go").addEventListener("click", () => {
        haptic();
        const minutes = +root.querySelector('input[name="length"]:checked').value;
        if (minutes !== state.settings.dumpMin) {
            state.settings.dumpMin = minutes;
            saveSettings();
        }
        begin(minutes);
    });
}

function begin(minutes) {
    saveDump({ phase: "write", startedAt: Date.now(), minutes, thoughts: [], cards: [], history: [], accepted: 0, deleted: 0 });
    writeScreen();
}

// ---- 2. запись ----
function writeScreen() {
    const dump = state.dump;
    const $ = mount(`
        <div class="dump-top">
            <button class="icon-btn" data-close aria-label="Свернуть">${ICONS.close}</button>
            <span class="dump-count" id="count"></span>
            <button class="chip-btn" id="toSort">Разобрать</button>
        </div>
        <div class="dump-timer mono" id="timer"></div>
        <div class="bar"><i id="progress"></i></div>
        <button class="dump-hint" id="hint" aria-live="polite"></button>
        <textarea class="textarea dump-input" id="thought" rows="1" enterkeyhint="enter" autocomplete="off"
                  placeholder="Одна мысль и Enter"></textarea>
        <div class="dump-list" id="list"></div>`);
    const input = $("#thought");
    let hintShift = 0;
    let shownHint = -1;
    let typedAt = 0;

    // fresh — сколько мыслей только что добавлено: им — подъём из поля ввода
    const renderList = (fresh = 0) => {
        const n = dump.thoughts.length;
        $("#count").textContent = n ? `${n} ${plural(n, "мысль", "мысли", "мыслей")}` : "";
        $("#list").innerHTML = dump.thoughts.slice().reverse()
            .map((thought, i) => `<button class="dump-thought${i < fresh ? " fresh" : ""}" data-thought="${esc(thought.id)}">${esc(thought.text)}</button>`).join("");
    };

    const update = () => {
        const total = dump.minutes * 60;
        const elapsed = Math.floor((Date.now() - dump.startedAt) / 1000);
        const left = Math.max(0, total - elapsed);
        const over = left === 0;
        $("#timer").innerHTML = over ? `<small>время вышло</small>` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
        $("#timer").classList.toggle("over", over);
        $("#progress").style.transform = `scaleX(${Math.min(1, elapsed / total)})`;
        $("#toSort").classList.toggle("ready", over && dump.thoughts.length > 0);
        const index = (Math.floor(elapsed / HINT_EVERY) + hintShift) % HINTS.length;
        if (index !== shownHint && (shownHint === -1 || Date.now() - typedAt > HINT_QUIET)) {
            shownHint = index;
            $("#hint").textContent = HINTS[index];
            $("#hint").classList.remove("fresh");
            void $("#hint").offsetWidth; // перезапуск анимации появления
            $("#hint").classList.add("fresh");
        }
    };

    renderList();
    update();
    tick = setInterval(update, 1000);
    navigator.wakeLock?.request("screen").then(lock => wakeLock = lock).catch(() => { });
    input.focus();

    // нажатие на подсказку — следующая тема
    $("#hint").addEventListener("click", () => {
        hintShift++;
        update();
        input.focus();
    });

    const add = () => {
        const parts = splitThoughts(input.value);
        input.value = "";
        input.style.height = "";
        if (!parts.length) {
            return;
        }
        haptic();
        parts.forEach(text => dump.thoughts.push({ id: crypto.randomUUID().slice(0, 8), text }));
        saveDump(dump);
        renderList(parts.length);
    };
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            add();
        }
    });
    input.addEventListener("input", () => {
        typedAt = Date.now();
        input.style.height = "auto";
        input.style.height = input.scrollHeight + "px";
    });

    // опечатка на скорости: коснись мысли — правишь прямо в строке; Enter — сохранить, пустая — удалить
    $("#list").addEventListener("click", event => {
        const row = event.target.closest("[data-thought]");
        const thought = row && dump.thoughts.find(item => item.id === row.dataset.thought);
        if (!thought) {
            return;
        }
        const edit = document.createElement("textarea");
        edit.className = "textarea dump-edit";
        edit.rows = 1;
        edit.value = thought.text;
        edit.setAttribute("enterkeyhint", "done");
        row.replaceWith(edit);
        edit.focus();
        edit.setSelectionRange(edit.value.length, edit.value.length);
        const grow = () => {
            edit.style.height = "auto";
            edit.style.height = edit.scrollHeight + "px";
        };
        grow();
        edit.addEventListener("input", () => {
            typedAt = Date.now();
            grow();
        });
        let saved = false;
        const save = () => {
            if (saved) {
                return;
            }
            saved = true;
            const text = edit.value.trim();
            if (text) {
                thought.text = text;
            } else {
                dump.thoughts.splice(dump.thoughts.indexOf(thought), 1);
            }
            saveDump(dump);
            renderList();
        };
        edit.addEventListener("keydown", keyEvent => {
            if (keyEvent.key === "Enter") {
                keyEvent.preventDefault();
                save();
                input.focus();
            }
        });
        edit.addEventListener("blur", save);
    });

    $("#toSort").addEventListener("click", () => {
        add(); // недописанная мысль тоже в дело
        if (!dump.thoughts.length) {
            showToast("Пока ни одной мысли");
            input.focus();
            return;
        }
        haptic();
        dump.phase = "sort";
        dump.cards = dump.thoughts.map(thought => {
            const fields = sortThought(thought.text, state.lists);
            return { text: thought.text, task: newTask({ ...fields, title: fields.title || thought.text }) };
        });
        saveDump(dump);
        wakeLock?.release().catch(() => { });
        wakeLock = null;
        sortScreen();
    });
}

// ---- 3. колода ----
function cardMeta(task) {
    const parts = [task.plannedAt
        ? relativeDay(task.plannedAt) + (hasTime(task.plannedAt) ? " в " + timeText(task.plannedAt) : "")
        : "во Входящие"];
    if (task.list) {
        parts.push(listName(task.list));
    }
    if (task.durationMin) {
        parts.push(durationText(task.durationMin));
    }
    if (task.priority === "high") {
        parts.push("важно");
    }
    const energy = task.energy ? ` · <span class="energy">${ENERGY_DOTS[task.energy]}</span>` : "";
    return parts.map(esc).join(" · ") + energy;
}

function cardHtml(card, cls) {
    const title = card.task.title;
    // исходная фраза видна, если разбор что-то из неё вырезал
    const source = title.toLowerCase() !== card.text.toLowerCase() ? `<div class="source">«${esc(card.text)}»</div>` : "";
    return `
        <div class="deck-card ${cls}">
            <div class="name">${esc(title)}</div>
            <div class="info">${cardMeta(card.task)}</div>
            ${source}
        </div>`;
}

function sortScreen() {
    const dump = state.dump;
    const total = dump.cards.length + dump.history.length;
    const [card, next] = dump.cards;
    const $ = mount(`
        <div class="dump-top">
            <button class="icon-btn" data-close aria-label="Свернуть">${ICONS.close}</button>
            <span class="dump-count mono">${dump.history.length + 1} из ${total}</span>
            ${dump.history.length ? `<button class="chip-btn" id="undo">Отменить</button>` : "<span></span>"}
        </div>
        <div class="deck">
            ${next ? cardHtml(next, "behind") : ""}
            ${cardHtml(card, "top")}
        </div>
        <p class="deck-tip">Вправо — в&nbsp;план, влево — удалить, нажми — поправить</p>
        <div class="btns">
            <button class="btn ghost" data-swipe="left">Удалить</button>
            <button class="btn primary" data-swipe="right">В&nbsp;план</button>
        </div>`);
    const top = $(".deck-card.top");

    let busy = false;
    const decide = dir => {
        if (busy) {
            return;
        }
        busy = true;
        haptic();
        top.classList.add("gone");
        top.style.transform = `translateX(${dir === "right" ? 130 : -130}%) rotate(${dir === "right" ? 12 : -12}deg)`;
        dump.cards.shift();
        if (dir === "right") {
            saveTask({ ...card.task }); // копия: черновик и план не делят один объект
            dump.accepted++;
        } else {
            dump.deleted++;
        }
        dump.history.push({ ...card, accepted: dir === "right" });
        saveDump(dump);
        setTimeout(() => dump.cards.length ? sortScreen() : afterDeck(), 220);
    };

    root.querySelectorAll("[data-swipe]").forEach(button => button.addEventListener("click", () => decide(button.dataset.swipe)));
    swipeable(top, decide, () => editTask(card.task, {
        onSave: task => {
            card.task = task;
            saveDump(dump);
            sortScreen();
        },
        onDelete: () => decide("left")
    }));

    $("#undo")?.addEventListener("click", undoLast);
}

// колода разобрана: принятое раскладываем по важности, если там есть что раскладывать
function afterDeck() {
    const dump = state.dump;
    const accepted = dump.history.filter(card => card.accepted && state.tasks.has(card.task.id));
    if (accepted.length >= 2) {
        dump.phase = "matrix";
        saveDump(dump);
        matrixStep();
    } else {
        summaryScreen();
    }
}

// шаг «важно или нет»: матрица только с задачами этой выгрузки, поверх экрана выгрузки
function matrixStep() {
    const dump = state.dump;
    const ids = dump.history.filter(card => card.accepted).map(card => card.task.id);
    summaryScreen();
    openMatrix({
        ids,
        placed: dump.placed || [],
        onPlace: placed => {
            dump.placed = placed;
            saveDump(dump);
        },
        onDone: () => {
            if (state.dump) {
                dump.phase = "summary";
                saveDump(dump);
            }
        }
    });
}

// последняя карточка возвращается в колоду, принятая задача стирается из плана
function undoLast() {
    haptic();
    const dump = state.dump;
    const last = dump.history.pop();
    if (last.accepted) {
        const saved = state.tasks.get(last.task.id);
        if (saved) {
            discardTask(saved);
        }
        dump.accepted--;
    } else {
        dump.deleted--;
    }
    delete last.accepted;
    dump.cards.unshift(last);
    saveDump(dump);
    sortScreen();
}

// перетаскивание пальцем; короткое касание без сдвига — onTap
function swipeable(card, onSwipe, onTap) {
    let startX = null;
    let startT = 0;
    let dx = 0;
    const reset = () => {
        startX = null;
        card.classList.remove("dragging");
        card.style.transform = "";
        card.dataset.dir = "";
    };
    card.addEventListener("pointerdown", event => {
        startX = event.clientX;
        startT = event.timeStamp;
        dx = 0;
        card.setPointerCapture(event.pointerId);
        card.classList.add("dragging");
    });
    card.addEventListener("pointermove", event => {
        if (startX === null) {
            return;
        }
        dx = event.clientX - startX;
        card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
        card.dataset.dir = dx > 40 ? "right" : dx < -40 ? "left" : "";
    });
    card.addEventListener("pointerup", event => {
        if (startX === null) {
            return;
        }
        const moved = dx;
        card.classList.remove("dragging");
        startX = null;
        // далеко протянули или быстро смахнули
        const flick = Math.abs(moved) >= 24 && Math.abs(moved) / Math.max(1, event.timeStamp - startT) > 0.11;
        if (Math.abs(moved) > card.offsetWidth * 0.3 || flick) {
            onSwipe(moved > 0 ? "right" : "left");
            return;
        }
        reset();
        if (Math.abs(moved) < 6) {
            onTap();
        }
    });
    card.addEventListener("pointercancel", reset);
}

// ---- 4. итог ----
function summaryScreen() {
    const dump = state.dump;
    const accepted = dump.history.filter(card => card.accepted);
    const inbox = accepted.filter(card => !card.task.plannedAt).length;
    const $ = mount(`
        <div class="dump-top">
            <span></span>
            <span></span>
            ${dump.history.length ? `<button class="chip-btn" id="undo">Отменить</button>` : "<span></span>"}
        </div>
        <div class="empty">
            <svg class="mark" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22"/><path d="M22 33l7 7 13-15"/></svg>
            <h1 class="title">Голова чище</h1>
            <p>В&nbsp;план: <span class="mono">${dump.accepted}</span>${inbox ? `, из&nbsp;них во&nbsp;Входящих <span class="mono">${inbox}</span>` : ""}.
               Удалено: <span class="mono">${dump.deleted}</span>.</p>
        </div>
        <div class="btns">
            ${inbox ? `<button class="btn ghost" id="toInbox">Во&nbsp;Входящие</button>` : ""}
            <button class="btn primary" id="finish">Готово</button>
        </div>`);

    const finish = screen => {
        haptic();
        finishDump();
        unmount();
        onDone?.(screen);
    };
    $("#finish").addEventListener("click", () => finish("today"));
    $("#toInbox")?.addEventListener("click", () => finish("inbox"));
    $("#undo")?.addEventListener("click", undoLast);
}
