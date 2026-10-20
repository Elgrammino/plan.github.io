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

    // тянуть вниз за полосу с ручкой: идёт за пальцем; ниже трети или быстрый взмах — закрыть
    const grip = sheet.querySelector(".sheet-grip");
    let startY = 0, startT = 0, dy = 0, pointer = null;
    grip.addEventListener("pointerdown", event => {
        pointer = event.pointerId;
        startY = event.clientY;
        startT = event.timeStamp;
        dy = 0;
        grip.setPointerCapture(pointer);
        sheet.classList.remove("settle");
        sheet.classList.add("dragging");
    });
    grip.addEventListener("pointermove", event => {
        if (event.pointerId !== pointer) {
            return;
        }
        const raw = event.clientY - startY;
        dy = raw > 0 ? raw : -Math.sqrt(-raw) * 2; // вверх — с сопротивлением
        sheet.style.transform = `translateY(${dy}px)`;
        backdrop.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / sheet.offsetHeight));
    });
    const release = event => {
        if (event.pointerId !== pointer) {
            return;
        }
        pointer = null;
        sheet.classList.remove("dragging");
        const speed = dy / Math.max(1, event.timeStamp - startT);
        if (dy > sheet.offsetHeight / 3 || (speed > FLICK && dy > 12)) {
            close("dismiss");
        } else {
            sheet.classList.add("settle");
            sheet.style.transform = "";
            backdrop.style.opacity = "";
        }
    };
    grip.addEventListener("pointerup", release);
    grip.addEventListener("pointercancel", release);
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
