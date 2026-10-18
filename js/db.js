// IndexedDB: все данные живут только в телефоне.
// Новая структура — новый номер DB_VERSION и новый шаг в upgrade(), старые шаги не трогать.
const DB_NAME = "plan";
const DB_VERSION = 1;

let dbPromise = null;

function upgrade(db, oldVersion) {
    if (oldVersion < 1) {
        db.createObjectStore("meta"); // ключ-значение: настройки, счётчики, служебное
        const tasks = db.createObjectStore("tasks", { keyPath: "id" });
        tasks.createIndex("list", "list");
        tasks.createIndex("batch", "batch");
    }
}

export function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = event => upgrade(request.result, event.oldVersion);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

function done(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function store(name, mode = "readonly") {
    const db = await openDb();
    return db.transaction(name, mode).objectStore(name);
}

export async function getMeta(key) {
    return done((await store("meta")).get(key));
}

export async function setMeta(key, value) {
    return done((await store("meta", "readwrite")).put(value, key));
}
