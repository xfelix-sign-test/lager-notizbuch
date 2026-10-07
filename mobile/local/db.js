/*
 * Lager-Notizbuch
 * Lokale Offline-Datenbank
 *
 * Diese Datei definiert die lokale Datenstruktur
 * für die mobile App.
 */

const DB_NAME = "lager-notizbuch";

let database = null;

export async function initLocalDatabase() {
    /*
     * Die eigentliche native SQLite-Anbindung wird
     * im nächsten Schritt über Capacitor ergänzt.
     *
     * Bis dahin verwenden wir IndexedDB als Web-Fallback.
     */

    if (database) {
        return database;
    }

    database = await openIndexedDB();

    return database;
}

function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains("notes")) {
                const notes = db.createObjectStore(
                    "notes",
                    { keyPath: "id" }
                );

                notes.createIndex(
                    "user_id",
                    "user_id",
                    { unique: false }
                );

                notes.createIndex(
                    "updated_at",
                    "updated_at",
                    { unique: false }
                );
            }

            if (!db.objectStoreNames.contains("contacts")) {
                const contacts = db.createObjectStore(
                    "contacts",
                    { keyPath: "id" }
                );

                contacts.createIndex(
                    "user_id",
                    "user_id",
                    { unique: false }
                );
            }

            if (!db.objectStoreNames.contains("settings")) {
                db.createObjectStore(
                    "settings",
                    { keyPath: "user_id" }
                );
            }

            if (!db.objectStoreNames.contains("sync")) {
                db.createObjectStore(
                    "sync",
                    { keyPath: "key" }
                );
            }

            if (!db.objectStoreNames.contains("session")) {
                db.createObjectStore(
                    "session",
                    { keyPath: "key" }
                );
            }

            if (!db.objectStoreNames.contains("session")) {
                db.createObjectStore(
                    "session",
                    { keyPath: "key" }
                );
            }
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

export async function localGet(storeName, key) {
    const db = await initLocalDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            storeName,
            "readonly"
        );

        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => {
            resolve(request.result || null);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

export async function localPut(storeName, value) {
    const db = await initLocalDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            storeName,
            "readwrite"
        );

        const store = transaction.objectStore(storeName);
        const request = store.put(value);

        request.onsuccess = () => {
            resolve(value);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

export async function localDelete(storeName, key) {
    const db = await initLocalDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            storeName,
            "readwrite"
        );

        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => {
            resolve(true);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

export async function localGetAll(storeName) {
    const db = await initLocalDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            storeName,
            "readonly"
        );

        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result || []);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}
