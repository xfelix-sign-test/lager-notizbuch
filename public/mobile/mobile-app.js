import {
    initLocalDatabase
} from "./local/db.js";

import {
    startAutomaticSync
} from "./local/sync.js";

import {
    getLocalSession
} from "./local/auth.js";

export async function initializeMobileApp() {
    try {
        await initLocalDatabase();

        const localUser =
            await getLocalSession();

        if (localUser) {
            document.body.classList.add(
                "mobile-session-available"
            );
        }

        await startAutomaticSync();

        console.log(
            "Lager-Notizbuch Mobile Offline-System gestartet."
        );

    } catch (error) {
        console.error(
            "Mobile initialization failed:",
            error
        );
    }
}
