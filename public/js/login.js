const API_BASE_URL = "http://162.120.6.76:3000";

const form = document.getElementById("loginForm");
const errorElement = document.getElementById("error");

async function getLocalSession() {
    try {
        const dbRequest = indexedDB.open("lager-notizbuch");

        return await new Promise((resolve) => {
            dbRequest.onsuccess = () => {
                const db = dbRequest.result;

                if (!db.objectStoreNames.contains("session")) {
                    resolve(null);
                    return;
                }

                const transaction = db.transaction("session", "readonly");
                const store = transaction.objectStore("session");
                const request = store.get("current-user");

                request.onsuccess = () => {
                    resolve(request.result?.user || null);
                };

                request.onerror = () => resolve(null);
            };

            dbRequest.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

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

        /* Benutzer lokal speichern */
        try {
            const dbRequest =
                indexedDB.open("lager-notizbuch");

            dbRequest.onsuccess = () => {
                const db = dbRequest.result;

                if (db.objectStoreNames.contains("session")) {
                    const transaction =
                        db.transaction("session", "readwrite");

                    transaction.objectStore("session").put({
                        key: "current-user",
                        user: {
                            username: data.username,
                            is_admin: data.is_admin
                        }
                    });
                }
            };
        } catch {}

        window.location.href = "/app";

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
