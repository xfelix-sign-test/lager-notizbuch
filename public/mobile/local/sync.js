import { API_BASE_URL } from "../api-config.js";
import {
    localGetAll,
    localPut,
    localDelete,
    localGet
} from "./db.js";

const SYNC_KEY = "last-sync";

export async function getLastSync() {
    const result = await localGet(
        "sync",
        SYNC_KEY
    );

    return result?.value || null;
}

export async function setLastSync(value) {
    await localPut("sync", {
        key: SYNC_KEY,
        value
    });
}

export async function isOnline() {
    return navigator.onLine;
}

export async function syncWithServer() {
    if (!navigator.onLine) {
        return {
            success: false,
            offline: true
        };
    }

    const lastSync = await getLastSync();

    try {
        /*
         * Der Server-Sync-Endpunkt wird im nächsten Schritt
         * in server.js ergänzt.
         */

        const response = await fetch(API_BASE_URL + 
            "/api/sync",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    lastSync
                })
            }
        );

        if (!response.ok) {
            throw new Error(
                "Synchronisierung fehlgeschlagen."
            );
        }

        const data = await response.json();

        if (Array.isArray(data.notes)) {
            for (const note of data.notes) {
                await localPut(
                    "notes",
                    note
                );
            }
        }

        if (Array.isArray(data.contacts)) {
            for (const contact of data.contacts) {
                await localPut(
                    "contacts",
                    contact
                );
            }
        }

        if (data.settings) {
            await localPut(
                "settings",
                data.settings
            );
        }

        if (data.syncTime) {
            await setLastSync(
                data.syncTime
            );
        }

        return {
            success: true,
            data
        };

    } catch (error) {
        console.error(
            "OFFLINE SYNC:",
            error
        );

        return {
            success: false,
            error
        };
    }
}

export async function startAutomaticSync() {
    window.addEventListener(
        "online",
        async () => {
            await syncWithServer();
        }
    );

    if (navigator.onLine) {
        await syncWithServer();
    }

    setInterval(
        async () => {
            if (navigator.onLine) {
                await syncWithServer();
            }
        },
        60 * 1000
    );
}
