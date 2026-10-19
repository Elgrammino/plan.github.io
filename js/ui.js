// Общие кусочки интерфейса: экранирование, вибрация, тосты, шторки.

export function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
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
    toast.innerHTML = `<span>${esc(text)}</span>` + (actionText ? `<button class="btn ghost">${esc(actionText)}</button>` : "");
    toast.querySelector("button")?.addEventListener("click", () => {
        toast.remove();
        action();
    });
    document.body.append(toast);
    if (ms) {
        toastTimer = setTimeout(() => toast.remove(), ms);
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

export function openSheet(html, { onClose } = {}) {
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.innerHTML = html;
    document.body.append(backdrop, sheet);
    document.body.style.overflow = "hidden";

    let closed = false;
    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        onClose?.();
        backdrop.remove();
        sheet.remove();
        document.body.style.overflow = "";
    };
    backdrop.addEventListener("click", close);
    return { sheet, close };
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
    trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`
};
