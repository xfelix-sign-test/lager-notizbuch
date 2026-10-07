import {
    localGet,
    localPut,
    localDelete
} from "./db.js";

const SESSION_KEY = "current-user";

export async function saveLocalSession(user) {
    await localPut("session", {
        key: SESSION_KEY,
        user
    });
}

export async function getLocalSession() {
    const result = await localGet(
        "session",
        SESSION_KEY
    );

    if (!result) {
        return null;
    }

    if (result.expiresAt && Date.now() > result.expiresAt) {
        await clearLocalSession();
        return null;
    }

    return result?.user || null;
}

export async function clearLocalSession() {
    await localDelete(
        "session",
        SESSION_KEY
    );
}

export async function hasLocalSession() {
    return Boolean(
        await getLocalSession()
    );
}
