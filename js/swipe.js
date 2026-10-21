// Свайп по строке задачи: вправо — готово, влево — перенести.
// Строка двигается только по горизонтали, вертикальную прокрутку отдаём браузеру (touch-action: pan-y).
// Решаем по углу: почти горизонтально — свайп, всё остальное — прокрутка.
const LIMIT = 72;  // столько пикселей нужно протянуть, чтобы сработало
const START = 12;  // до этого сдвига не решаем, свайп это или прокрутка
const SLOPE = 1.7; // свайп — только почти по горизонтали: dx больше dy в 1,7 раза (угол до ~30°)
const FLICK = 0.11; // px/мс: быстрый короткий взмах тоже засчитывается…
const FLICK_MIN = 24; // …если строку сдвинули хотя бы на столько

export function swipeRows(container, { onRight, onLeft }) {
    let row = null;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let lastDx = 0;
    let active = false;
    let swallowClick = false;

    const reset = target => {
        target.classList.remove("swiping");
        [...target.children].forEach(child => child.style.transform = "");
        delete target.dataset.dir;
        delete target.dataset.ready;
    };

    container.addEventListener("pointerdown", event => {
        if (event.button !== 0) {
            return;
        }
        row = event.target.closest(".item[data-id]:not(.virtual)"); // будущий раз повтора не отмечается
        if (row?.classList.contains("leaving")) {
            row = null;
        }
        startX = event.clientX;
        startY = event.clientY;
        startT = event.timeStamp;
        lastDx = 0;
        active = false;
    });

    container.addEventListener("pointermove", event => {
        if (!row) {
            return;
        }
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!active) {
            if (Math.hypot(dx, dy) < START) {
                return;
            }
            if (Math.abs(dx) < Math.abs(dy) * SLOPE) {
                row = null; // косое и вертикальное — прокрутка
                return;
            }
            active = true;
            row.setPointerCapture?.(event.pointerId);
            row.classList.add("swiping");
        }
        lastDx = dx;
        // transform прямо на детях: переменная на строке пересчитывала бы стили всех потомков каждый кадр
        for (const child of row.children) {
            child.style.transform = `translateX(${dx}px)`;
        }
        row.dataset.dir = dx > 0 ? "right" : "left";
        if (Math.abs(dx) > LIMIT) {
            row.dataset.ready = "";
        } else {
            delete row.dataset.ready;
        }
    });

    container.addEventListener("pointerup", event => {
        if (!row) {
            return;
        }
        const target = row;
        row = null;
        if (!active) {
            return;
        }
        // после свайпа браузер пришлёт click по кнопке под пальцем — его глотаем
        swallowClick = true;
        setTimeout(() => swallowClick = false, 400);
        const flick = Math.abs(lastDx) >= FLICK_MIN && Math.abs(lastDx) / Math.max(1, event.timeStamp - startT) > FLICK;
        const dir = target.dataset.ready !== undefined || flick ? target.dataset.dir : null;
        reset(target);
        if (dir === "right") {
            onRight(target);
        } else if (dir === "left") {
            onLeft(target);
        }
    });

    // пока строка едет, страницу не прокручиваем: иначе палец чуть ушёл вниз —
    // iOS забирает жест себе (pointercancel), и строка дёргается назад
    // Ещё до решения: первое же почти горизонтальное движение придерживаем, чтобы iOS не начал прокрутку.
    let touchX = 0, touchY = 0;
    container.addEventListener("touchstart", event => {
        touchX = event.touches[0].clientX;
        touchY = event.touches[0].clientY;
    }, { passive: true });
    container.addEventListener("touchmove", event => {
        if (!row || event.touches.length !== 1) {
            return;
        }
        const dx = Math.abs(event.touches[0].clientX - touchX);
        const dy = Math.abs(event.touches[0].clientY - touchY);
        if (active || (dx > 2 && dx > dy * SLOPE)) {
            event.cancelable && event.preventDefault();
        }
    }, { passive: false });

    container.addEventListener("pointercancel", () => {
        if (row) {
            reset(row);
            row = null;
        }
    });

    container.addEventListener("click", event => {
        if (swallowClick) {
            swallowClick = false;
            event.stopPropagation();
            event.preventDefault();
        }
    }, true);
}
