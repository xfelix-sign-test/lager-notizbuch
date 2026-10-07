const API_BASE_URL = "http://162.120.6.76:3000";

const DB_NAME = "lager-notizbuch";
const DB_VERSION = 1;

const form = document.getElementById("loginForm");
const errorElement = document.getElementById("error");

async function getLocalSession() {
    try {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const database = event.target.result;

                if (!database.objectStoreNames.contains("notes")) {
                    database.createObjectStore("notes", { keyPath: "id" });
                }

                if (!database.objectStoreNames.contains("contacts")) {
                    database.createObjectStore("contacts", { keyPath: "id" });
                }

                if (!database.objectStoreNames.contains("settings")) {
                    database.createObjectStore("settings", { keyPath: "user_id" });
                }

                if (!database.objectStoreNames.contains("sync")) {
                    database.createObjectStore("sync", { keyPath: "key" });
                }

                if (!database.objectStoreNames.contains("session")) {
                    database.createObjectStore("session", { keyPath: "key" });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (!db.objectStoreNames.contains("session")) {
            return null;
        }

        const session = await new Promise((resolve, reject) => {
            const transaction = db.transaction("session", "readonly");
            const request = transaction.objectStore("session").get("current-user");

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });

        if (
            session?.token &&
            session?.expiresAt &&
            Date.now() < session.expiresAt
        ) {
            return session;
        }

        return null;

    } catch (error) {
        console.error("Lokale Sitzung konnte nicht gelesen werden:", error);
        return null;
    }
}

async function checkRememberedLogin() {
    const session = await getLocalSession();

    if (session?.token) {
        window.location.href = "/app";
    }
}

checkRememberedLogin();

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorElement.textContent = "";

    const username =
        document.getElementById("username").value.trim();

    const password =
        document.getElementById("password").value;

    if (!username) {
        errorElement.textContent =
            "Bitte Benutzernamen eingeben.";
        return;
    }

    /* OFFLINE-LOGIN */
    if (!navigator.onLine) {
        const localUser = await getLocalSession();

        if (localUser && localUser.username === username) {
            window.location.href = "/app";
            return;
        }

        errorElement.textContent =
            "Offline: Dieser Benutzer wurde auf diesem Gerät noch nicht angemeldet.";
        return;
    }

    /* ONLINE-LOGIN */
    try {
        const response = await fetch(
            API_BASE_URL + "/api/login",
            {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    password
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            errorElement.textContent =
                data.error ||
                "Anmeldung fehlgeschlagen.";
            return;
        }

        if (data.setup_required) {
            window.location.href =
                API_BASE_URL + "/setup";
            return;
        }

        /* Benutzer und Mobile-Token lokal speichern */
        try {
            const db = await new Promise((resolve, reject) => {
                const r = indexedDB.open(DB_NAME, DB_VERSION);
                r.onupgradeneeded = e => {
                    const d = e.target.result;
                    if (!d.objectStoreNames.contains("session"))
                        d.createObjectStore("session", {keyPath:"key"});
                };
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
            });

            const tx = db.transaction("session", "readwrite");
            tx.objectStore("session").put({
                key: "current-user",
                user: {username, is_admin: data.is_admin},
                token: data.token,
                expiresAt: Date.now() + 86400000
            });

            tx.oncomplete = () => window.location.href = "/app";
            tx.onerror = () => window.location.href = "/app";
        } catch (error) {
            console.error("Login-Speicherung fehlgeschlagen:", error);
            window.location.href = "/app";
        }

        /* Weiterleitung erfolgt nach abgeschlossenem IndexedDB-Speichern */

    } catch (error) {
        /* Internet weg während Login */
        const localUser = await getLocalSession();

        if (localUser && localUser.username === username) {
            window.location.href = "/app";
            return;
        }

        errorElement.textContent =
            "Server nicht erreichbar.";
    }
});
