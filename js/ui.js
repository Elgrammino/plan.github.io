// Общие кусочки интерфейса: экранирование, вибрация, тосты, шторки.

export function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// название задачи: «14-го», «2-й» не рвутся на дефисе (неразрывный дефис между цифрой и окончанием)
export function escTitle(text) {
    return esc(text).replace(/(\d)-(?=[а-яё])/gi, "$1‑");
}

// ---- вибрация ----
// В Safari на iPhone нет navigator.vibrate, но переключение системного <input type="checkbox" switch> (iOS 18+)
// даёт лёгкий тик. Работает только внутри нажатия (обработчик click), как в калькуляторе.
let hapticLabel;
export function haptic() {
    try {
        if (!hapticLabel) {
            const input = document.createElement("input");
            input.type = "checkbox";
            input.setAttribute("switch", "");
            hapticLabel = document.createElement("label");
            hapticLabel.setAttribute("aria-hidden", "true");
            hapticLabel.style.display = "none";
            hapticLabel.append(input);
            document.head.append(hapticLabel);
        }
        hapticLabel.click();
    } catch (e) { }
}

// ---- тихое сообщение снизу ----
let toastTimer;
export function showToast(text, actionText, action, ms = 4000) {
    document.querySelector(".toast")?.remove();
    clearTimeout(toastTimer);
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status"); // VoiceOver прочитает, фокус не уводит
    toast.innerHTML = `<span>${esc(text)}</span>` + (actionText ? `<button class="btn ghost">${esc(actionText)}</button>` : "");
    toast.querySelector("button")?.addEventListener("click", () => {
        leave(toast);
        action();
    });
    document.body.append(toast);
    if (ms) {
        toastTimer = setTimeout(() => leave(toast), ms);
    }
}

// ---- шторка снизу ----
// Клавиатура iOS не двигает fixed-элементы: поднимаем шторку на её высоту сами.
if (window.visualViewport) {
    const update = () => {
        const kb = Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop);
        document.documentElement.style.setProperty("--kb", kb + "px");
    };
    visualViewport.addEventListener("resize", update);
    visualViewport.addEventListener("scroll", update);
}

// Страница под шторкой и полноэкранным окном не должна ехать. На iPhone overflow: hidden у body
// прокрутку пальцем не держит, поэтому фиксируем body на месте и возвращаем позицию после.
// Счётчик: две шторки подряд — страница отпускается, только когда закрыта последняя.
let scrollLocks = 0;
let lockedY = 0;
export function lockScroll() {
    if (scrollLocks++ === 0) {
        lockedY = window.scrollY;
        Object.assign(document.body.style, { position: "fixed", top: `-${lockedY}px`, left: "0", right: "0", overflow: "hidden" });
    }
}

export function unlockScroll() {
    if (scrollLocks === 0) {
        return;
    }
    if (--scrollLocks === 0) {
        Object.assign(document.body.style, { position: "", top: "", left: "", right: "", overflow: "" });
        window.scrollTo(0, lockedY);
    }
}

// плавный уход: класс .leaving в CSS, потом удаляем
export function leave(element, ms = 170) {
    element.classList.add("leaving");
    element.inert = true;
    setTimeout(() => element.remove(), ms);
}

const FLICK = 0.11; // px/мс: быстрее — считаем смахиванием, даже если протянули немного

// ближайший предок внутри шторки, который прокручивается по вертикали
function scrollerOf(element, root) {
    for (let node = element; node && node !== root; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
            return node;
        }
    }
    return null;
}

export function openSheet(html, { onClose } = {}) {
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.innerHTML = `<div class="sheet-grip" aria-hidden="true"></div>` + html;
    document.body.append(backdrop, sheet);
    lockScroll();

    let closed = false;
    const close = (how = "leave") => {
        if (closed) {
            return;
        }
        closed = true;
        onClose?.();
        if (how === "dismiss") {
            // смахнули: уезжает вниз целиком, с той точки, где отпустили
            sheet.classList.remove("dragging", "settle");
            sheet.style.transform = "";
            sheet.classList.add("dismiss");
            sheet.inert = true;
            setTimeout(() => sheet.remove(), 260);
            leave(backdrop);
        } else {
            leave(sheet);
            leave(backdrop);
        }
        unlockScroll();
    };
    backdrop.addEventListener("click", () => close());

    // шторка идёт за пальцем вниз; ниже трети или быстрый взмах — закрыть
    let startY = 0, startT = 0, dy = 0;
    const begin = (y, time) => {
        startY = y;
        startT = time;
        dy = 0;
        sheet.classList.remove("settle");
        sheet.classList.add("dragging");
    };
    const move = y => {
        const raw = y - startY;
        dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2; // вверх — с сопротивлением
        sheet.style.transform = `translateY(${dy}px)`;
        backdrop.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / sheet.offsetHeight));
    };
    const finish = time => {
        sheet.classList.remove("dragging");
        const speed = dy / Math.max(1, time - startT);
        if (dy > sheet.offsetHeight / 3 || (speed > FLICK && dy > 12)) {
            close("dismiss");
        } else {
            sheet.classList.add("settle");
            sheet.style.transform = "";
            backdrop.style.opacity = "";
        }
    };

    // мышь и стилус — за ручку
    const grip = sheet.querySelector(".sheet-grip");
    let pointer = null;
    grip.addEventListener("pointerdown", event => {
        if (event.pointerType === "touch") {
            return; // палец ведут касания ниже
        }
        pointer = event.pointerId;
        grip.setPointerCapture(pointer);
        begin(event.clientY, event.timeStamp);
    });
    grip.addEventListener("pointermove", event => event.pointerId === pointer && move(event.clientY));
    const release = event => {
        if (event.pointerId === pointer) {
            pointer = null;
            finish(event.timeStamp);
        }
    };
    grip.addEventListener("pointerup", release);
    grip.addEventListener("pointercancel", release);

    // палец — за любое место шторки, как в iOS: вниз тянется вся шторка, если её содержимое
    // уже наверху; иначе — обычная прокрутка. Касания, а не pointer: иначе iOS забирает жест себе.
    // Вне прокрутки страницу не отдаём вовсе — она пружинила под шторкой.
    let touch = null;
    sheet.addEventListener("touchstart", event => {
        if (event.touches.length !== 1) {
            touch = null;
            return;
        }
        // в поле, где сейчас печатают, палец выделяет текст — шторку не тянем
        if ((event.target.matches("input, textarea") && event.target === document.activeElement) || event.target.closest(".grip")) {
            touch = null;
            return;
        }
        const { clientX, clientY } = event.touches[0];
        touch = { x: clientX, y: clientY, time: event.timeStamp, scroller: scrollerOf(event.target, sheet), drag: false };
    }, { passive: true });
    sheet.addEventListener("touchmove", event => {
        if (!touch || event.touches.length !== 1) {
            return;
        }
        const { clientX, clientY } = event.touches[0];
        if (!touch.drag) {
            const dx = clientX - touch.x;
            const down = clientY - touch.y;
            if (Math.abs(down) < 6 && Math.abs(dx) < 6) {
                return;
            }
            const scroller = touch.scroller;
            const vertical = Math.abs(down) > Math.abs(dx);
            if (vertical && down > 0 && (!scroller || scroller.scrollTop <= 0)) {
                touch.drag = true;
                begin(clientY, touch.time);
            } else if (scroller || !vertical) {
                touch = null; // прокрутка содержимого или ряда чипов вбок
                return;
            } else {
                event.preventDefault();
                return;
            }
        }
        event.preventDefault();
        move(clientY);
    }, { passive: false });
    const endTouch = event => {
        if (touch?.drag) {
            finish(event.timeStamp);
        }
        touch = null;
    };
    sheet.addEventListener("touchend", endTouch);
    sheet.addEventListener("touchcancel", endTouch);
    backdrop.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
    return { sheet, close: () => close() };
}

export const ICONS = {
    prev: `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>`,
    next: `<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
    search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`,
    up: `<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>`,
    down: `<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`,
    timer: `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
    trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`
};
