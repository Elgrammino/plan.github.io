// Свайп по строке задачи: вправо — готово, влево — перенести.
// Строка двигается только по горизонтали, вертикальную прокрутку отдаём браузеру (touch-action: pan-y).
const LIMIT = 72;  // столько пикселей нужно протянуть, чтобы сработало
const START = 10;  // до этого сдвига не решаем, свайп это или прокрутка

export function swipeRows(container, { onRight, onLeft }) {
    let row = null;
    let startX = 0;
    let startY = 0;
    let active = false;
    let swallowClick = false;

    const reset = target => {
        target.classList.remove("swiping");
        target.style.removeProperty("--dx");
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
        active = false;
    });

    container.addEventListener("pointermove", event => {
        if (!row) {
            return;
        }
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!active) {
            if (Math.abs(dy) > START && Math.abs(dy) > Math.abs(dx)) {
                row = null; // это прокрутка
                return;
            }
            if (Math.abs(dx) < START) {
                return;
            }
            active = true;
            row.setPointerCapture?.(event.pointerId);
            row.classList.add("swiping");
        }
        row.style.setProperty("--dx", dx + "px");
        row.dataset.dir = dx > 0 ? "right" : "left";
        if (Math.abs(dx) > LIMIT) {
            row.dataset.ready = "";
        } else {
            delete row.dataset.ready;
        }
    });

    container.addEventListener("pointerup", () => {
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
        const dir = target.dataset.ready !== undefined ? target.dataset.dir : null;
        reset(target);
        if (dir === "right") {
            onRight(target);
        } else if (dir === "left") {
            onLeft(target);
        }
    });

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
