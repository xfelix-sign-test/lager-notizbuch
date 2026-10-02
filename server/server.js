import "dotenv/config";
import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!process.env.LOGIN_USERNAME || !process.env.LOGIN_PASSWORD) {
    throw new Error("LOGIN_USERNAME und LOGIN_PASSWORD müssen in .env gesetzt sein.");
}

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET muss in .env gesetzt sein.");
}

const db = await open({
    filename: path.join(DATA_DIR, "lager.db"),
    driver: sqlite3.Database
});

/* =========================================================
   DATENBANK
========================================================= */

await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_admin INTEGER NOT NULL DEFAULT 0,
        must_set_password INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'programme',
        user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT '',
        extension TEXT NOT NULL DEFAULT '',
        number TEXT NOT NULL DEFAULT '',
        mobile TEXT NOT NULL DEFAULT '',
        user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        theme TEXT NOT NULL DEFAULT 'dark',
        compact_mode INTEGER NOT NULL DEFAULT 0,
        department TEXT NOT NULL DEFAULT '',
        font_size TEXT NOT NULL DEFAULT 'medium',
        default_category TEXT NOT NULL DEFAULT 'programme',
        note_sort TEXT NOT NULL DEFAULT 'newest',
        notes_per_page INTEGER NOT NULL DEFAULT 20,
        contact_sort TEXT NOT NULL DEFAULT 'name',
        show_branch INTEGER NOT NULL DEFAULT 1,
        notifications INTEGER NOT NULL DEFAULT 1,
        save_confirmation INTEGER NOT NULL DEFAULT 1,
        auto_logout INTEGER NOT NULL DEFAULT 0
    );
`);

/* Fehlende Spalten bei älteren Datenbanken ergänzen */
async function ensureColumn(table, column, definition) {
    const columns = await db.all(`PRAGMA table_info(${table})`);

    if (!columns.some((col) => col.name === column)) {
        await db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
    }
}

await ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
await ensureColumn("users", "must_set_password", "INTEGER NOT NULL DEFAULT 0");

await ensureColumn("notes", "category", "TEXT NOT NULL DEFAULT 'programme'");
await ensureColumn("notes", "user_id", "INTEGER");

await ensureColumn("contacts", "user_id", "INTEGER");

await ensureColumn("user_settings", "department", "TEXT NOT NULL DEFAULT ''");
await ensureColumn("user_settings", "font_size", "TEXT NOT NULL DEFAULT 'medium'");
await ensureColumn(
    "user_settings",
    "default_category",
    "TEXT NOT NULL DEFAULT 'programme'"
);
await ensureColumn(
    "user_settings",
    "note_sort",
    "TEXT NOT NULL DEFAULT 'newest'"
);
await ensureColumn(
    "user_settings",
    "notes_per_page",
    "INTEGER NOT NULL DEFAULT 20"
);
await ensureColumn(
    "user_settings",
    "contact_sort",
    "TEXT NOT NULL DEFAULT 'name'"
);
await ensureColumn(
    "user_settings",
    "show_branch",
    "INTEGER NOT NULL DEFAULT 1"
);
await ensureColumn(
    "user_settings",
    "notifications",
    "INTEGER NOT NULL DEFAULT 1"
);
await ensureColumn(
    "user_settings",
    "save_confirmation",
    "INTEGER NOT NULL DEFAULT 1"
);
await ensureColumn(
    "user_settings",
    "auto_logout",
    "INTEGER NOT NULL DEFAULT 0"
);

/* =========================================================
   ADMIN-KONTO
========================================================= */

const adminUsername = process.env.LOGIN_USERNAME.trim();

let adminUser = await db.get(
    "SELECT * FROM users WHERE username = ?",
    adminUsername
);

if (!adminUser) {
    const passwordHash = await bcrypt.hash(
        process.env.LOGIN_PASSWORD,
        12
    );

    const result = await db.run(
        `
        INSERT INTO users
            (username, password_hash, is_admin, must_set_password)
        VALUES
            (?, ?, 1, 0)
        `,
        adminUsername,
        passwordHash
    );

    adminUser = await db.get(
        "SELECT * FROM users WHERE id = ?",
        result.lastID
    );
}

/*
 * WICHTIG:
 * Nur das in .env definierte Konto ist Admin.
 */
await db.run(
    `
    UPDATE users
    SET is_admin = CASE
        WHEN username = ? THEN 1
        ELSE 0
    END
    `,
    adminUsername
);

/* Alte Daten dem Admin zuordnen */
await db.run(
    `
    UPDATE notes
    SET user_id = ?
    WHERE user_id IS NULL
    `,
    adminUser.id
);

await db.run(
    `
    UPDATE contacts
    SET user_id = ?
    WHERE user_id IS NULL
    `,
    adminUser.id
);

await db.run(
    `
    INSERT OR IGNORE INTO user_settings
        (user_id, display_name, theme, compact_mode)
    VALUES
        (?, ?, 'dark', 0)
    `,
    adminUser.id,
    adminUsername
);

/* =========================================================
   INDEXE
========================================================= */

await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notes_user_id
    ON notes(user_id);

    CREATE INDEX IF NOT EXISTS idx_contacts_user_id
    ON contacts(user_id);

    CREATE INDEX IF NOT EXISTS idx_users_username
    ON users(username);
`);

/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const SQLiteStore = SQLiteStoreFactory(session);

app.use(
    session({
        store: new SQLiteStore({
            db: "sessions.db",
            dir: DATA_DIR
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "none",
            secure: false,
            maxAge: 1000 * 60 * 60 * 8
        }
    })
);

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   HILFSFUNKTIONEN
========================================================= */

function normalizeUsername(username) {
    return String(username || "").trim();
}

function validatePassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 6 &&
        password.length <= 200
    );
}

function validateUsername(username) {
    return (
        typeof username === "string" &&
        /^[A-Za-z0-9_-]{2,30}$/.test(username)
    );
}

async function getCurrentUser(req) {
    if (!req.session.userId) {
        return null;
    }

    return await db.get(
        `
        SELECT
            id,
            username,
            is_admin,
            must_set_password
        FROM users
        WHERE id = ?
        `,
        req.session.userId
    );
}

async function requireLogin(req, res, next) {
    const user = await getCurrentUser(req);

    if (!user) {
        return res.status(401).json({
            error: "Nicht angemeldet."
        });
    }

    req.user = user;
    next();
}

async function requireAdmin(req, res, next) {
    const user = await getCurrentUser(req);

    if (!user) {
        return res.status(401).json({
            error: "Nicht angemeldet."
        });
    }

    if (Number(user.is_admin) !== 1) {
        return res.status(403).json({
            error: "Keine Berechtigung."
        });
    }

    req.user = user;
    next();
}

function createTemporaryPassword() {
    return crypto
        .randomBytes(9)
        .toString("base64url")
        .replace(/[-_]/g, "")
        .slice(0, 12);
}

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {
    try {
        const username = normalizeUsername(req.body.username);
        const password =
            typeof req.body.password === "string"
                ? req.body.password
                : "";

        if (!username) {
            return res.status(400).json({
                error: "Benutzername fehlt."
            });
        }

        const user = await db.get(
            "SELECT * FROM users WHERE username = ?",
            username
        );

        if (!user) {
            return res.status(401).json({
                error: "Benutzername oder Passwort falsch."
            });
        }

        /*
         * Neuer Benutzer:
         * Nur Benutzername notwendig.
         * Danach geht es zur Passwort-Erstellung.
         */
        if (Number(user.must_set_password) === 1) {
            if (password !== "") {
                return res.status(400).json({
                    error: "Für diesen Benutzer muss zuerst ein eigenes Passwort festgelegt werden."
                });
            }

            req.session.pendingSetupUserId = user.id;
            req.session.pendingSetupExpires =
                Date.now() + 10 * 60 * 1000;

            return res.json({
                setup_required: true
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                error: "Benutzername oder Passwort falsch."
            });
        }

        req.session.userId = user.id;
        req.session.pendingSetupUserId = null;
        req.session.pendingSetupExpires = null;

        return res.json({
            success: true
        });
    } catch (error) {
        console.error("LOGIN ERROR:", error);

        return res.status(500).json({
            error: "Interner Serverfehler."
        });
    }
});

/* =========================================================
   PASSWORT BEIM ERSTEN LOGIN FESTLEGEN
========================================================= */

app.get("/api/setup-status", async (req, res) => {
    try {
        const userId = req.session.pendingSetupUserId;
        const expires = req.session.pendingSetupExpires;

        if (!userId || !expires || Date.now() > expires) {
            req.session.pendingSetupUserId = null;
            req.session.pendingSetupExpires = null;

            return res.json({
                setup_required: false
            });
        }

        const user = await db.get(
            `
            SELECT id, username, must_set_password
            FROM users
            WHERE id = ?
            `,
            userId
        );

        if (!user || Number(user.must_set_password) !== 1) {
            req.session.pendingSetupUserId = null;
            req.session.pendingSetupExpires = null;

            return res.json({
                setup_required: false
            });
        }

        return res.json({
            setup_required: true,
            username: user.username
        });
    } catch (error) {
        console.error("SETUP STATUS ERROR:", error);

        return res.status(500).json({
            error: "Interner Serverfehler."
        });
    }
});

app.post("/api/setup-password", async (req, res) => {
    try {
        const userId = req.session.pendingSetupUserId;
        const expires = req.session.pendingSetupExpires;

        if (!userId || !expires || Date.now() > expires) {
            return res.status(401).json({
                error: "Der Vorgang ist abgelaufen. Bitte erneut anmelden."
            });
        }

        const password = req.body.password || "";
        const passwordRepeat = req.body.passwordRepeat || "";

        if (!validatePassword(password)) {
            return res.status(400).json({
                error: "Das Passwort muss mindestens 6 Zeichen lang sein."
            });
        }

        if (password !== passwordRepeat) {
            return res.status(400).json({
                error: "Die Passwörter stimmen nicht überein."
            });
        }

        const user = await db.get(
            "SELECT * FROM users WHERE id = ?",
            userId
        );

        if (!user || Number(user.must_set_password) !== 1) {
            return res.status(400).json({
                error: "Passwort kann für diesen Benutzer nicht festgelegt werden."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        await db.run(
            `
            UPDATE users
            SET password_hash = ?,
                must_set_password = 0
            WHERE id = ?
            `,
            passwordHash,
            userId
        );

        req.session.userId = userId;
        req.session.pendingSetupUserId = null;
        req.session.pendingSetupExpires = null;

        return res.json({
            success: true
        });
    } catch (error) {
        console.error("SETUP PASSWORD ERROR:", error);

        return res.status(500).json({
            error: "Interner Serverfehler."
        });
    }
});

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/logout", async (req, res) => {
    req.session.destroy(() => {
        res.json({
            success: true
        });
    });
});

/* =========================================================
   ME
========================================================= */

app.get("/api/me", requireLogin, async (req, res) => {
    const settings = await db.get(
        `
        SELECT
            user_id,
            display_name,
            theme,
            compact_mode,
            department,
            font_size,
            default_category,
            note_sort,
            notes_per_page,
            contact_sort,
            show_branch,
            notifications,
            save_confirmation,
            auto_logout
        FROM user_settings
        WHERE user_id = ?
        `,
        req.user.id
    );

    res.json({
        authenticated: true,
        username: req.user.username,
        is_admin: Number(req.user.is_admin) === 1,
        settings
    });
});

app.post("/api/sync", requireLogin, async (req, res) => {
    const userId = req.user.id;
    const lastSync = req.body?.lastSync || "1970-01-01 00:00:00";

    const notes = await db.all(
        "SELECT * FROM notes WHERE user_id = ? AND updated_at > ?",
        userId, lastSync
    );

    const contacts = await db.all(
        "SELECT * FROM contacts WHERE user_id = ? AND updated_at > ?",
        userId, lastSync
    );

    const settings = await db.get(
        "SELECT * FROM user_settings WHERE user_id = ?",
        userId
    );

    res.json({
        notes,
        contacts,
        settings,
        syncTime: new Date().toISOString()
    });
});

/* =========================================================
   NOTIZEN
========================================================= */

app.get("/api/notes", requireLogin, async (req, res) => {
    try {
        const category = req.query.category;

        let rows;

        if (category) {
            rows = await db.all(
                `
                SELECT *
                FROM notes
                WHERE user_id = ?
                  AND category = ?
                ORDER BY updated_at DESC, id DESC
                `,
                req.user.id,
                category
            );
        } else {
            rows = await db.all(
                `
                SELECT *
                FROM notes
                WHERE user_id = ?
                ORDER BY updated_at DESC, id DESC
                `,
                req.user.id
            );
        }

        res.json(rows);
    } catch (error) {
        console.error("NOTES GET ERROR:", error);

        res.status(500).json({
            error: "Notizen konnten nicht geladen werden."
        });
    }
});

app.post("/api/notes", requireLogin, async (req, res) => {
    try {
        const title = String(req.body.title || "").trim();
        const content = String(req.body.content || "");
        const category = String(
            req.body.category || "programme"
        ).trim();

        if (!title) {
            return res.status(400).json({
                error: "Titel fehlt."
            });
        }

        const result = await db.run(
            `
            INSERT INTO notes
                (title, content, category, user_id)
            VALUES
                (?, ?, ?, ?)
            `,
            title,
            content,
            category,
            req.user.id
        );

        const note = await db.get(
            "SELECT * FROM notes WHERE id = ? AND user_id = ?",
            result.lastID,
            req.user.id
        );

        res.status(201).json(note);
    } catch (error) {
        console.error("NOTE CREATE ERROR:", error);

        res.status(500).json({
            error: "Notiz konnte nicht erstellt werden."
        });
    }
});

app.get("/api/notes/:id", requireLogin, async (req, res) => {
    const note = await db.get(
        `
        SELECT *
        FROM notes
        WHERE id = ?
          AND user_id = ?
        `,
        req.params.id,
        req.user.id
    );

    if (!note) {
        return res.status(404).json({
            error: "Notiz nicht gefunden."
        });
    }

    res.json(note);
});

app.put("/api/notes/:id", requireLogin, async (req, res) => {
    try {
        const title = String(req.body.title || "").trim();
        const content = String(req.body.content || "");
        const category = String(
            req.body.category || "programme"
        ).trim();

        if (!title) {
            return res.status(400).json({
                error: "Titel fehlt."
            });
        }

        const result = await db.run(
            `
            UPDATE notes
            SET
                title = ?,
                content = ?,
                category = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND user_id = ?
            `,
            title,
            content,
            category,
            req.params.id,
            req.user.id
        );

        if (result.changes === 0) {
            return res.status(404).json({
                error: "Notiz nicht gefunden."
            });
        }

        const note = await db.get(
            `
            SELECT *
            FROM notes
            WHERE id = ?
              AND user_id = ?
            `,
            req.params.id,
            req.user.id
        );

        res.json(note);
    } catch (error) {
        console.error("NOTE UPDATE ERROR:", error);

        res.status(500).json({
            error: "Notiz konnte nicht geändert werden."
        });
    }
});

app.delete("/api/notes/:id", requireLogin, async (req, res) => {
    const result = await db.run(
        `
        DELETE FROM notes
        WHERE id = ?
          AND user_id = ?
        `,
        req.params.id,
        req.user.id
    );

    if (result.changes === 0) {
        return res.status(404).json({
            error: "Notiz nicht gefunden."
        });
    }

    res.json({
        success: true
    });
});

/* =========================================================
   TELEFONVERZEICHNIS
========================================================= */

app.get("/api/contacts", requireLogin, async (req, res) => {
    try {
        const rows = await db.all(
            `
            SELECT *
            FROM contacts
            WHERE user_id = ?
            ORDER BY name COLLATE NOCASE ASC, id ASC
            `,
            req.user.id
        );

        res.json(rows);
    } catch (error) {
        console.error("CONTACTS GET ERROR:", error);

        res.status(500).json({
            error: "Telefonverzeichnis konnte nicht geladen werden."
        });
    }
});

app.post("/api/contacts", requireLogin, async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const branch = String(req.body.branch || "").trim();
        const extension = String(req.body.extension || "").trim();
        const number = String(req.body.number || "").trim();
        const mobile = String(req.body.mobile || "").trim();

        if (!name) {
            return res.status(400).json({
                error: "Name fehlt."
            });
        }

        if (!mobile && (!extension || !number)) {
            return res.status(400).json({
                error: "Ohne Mobilnummer müssen Durchwahl und Nummer angegeben werden."
            });
        }

        if (extension && !/^[0-9]{3}$/.test(extension)) {
            return res.status(400).json({
                error: "Die Durchwahl muss genau 3 Ziffern haben."
            });
        }

        if (number && !/^[0-9]{3}$/.test(number)) {
            return res.status(400).json({
                error: "Die Nummer muss genau 3 Ziffern haben."
            });
        }

        if (mobile && !/^[0-9]{1,20}$/.test(mobile)) {
            return res.status(400).json({
                error: "Die Mobilnummer darf nur Ziffern und maximal 20 Stellen enthalten."
            });
        }

        const result = await db.run(
            `
            INSERT INTO contacts
                (name, branch, extension, number, mobile, user_id)
            VALUES
                (?, ?, ?, ?, ?, ?)
            `,
            name,
            branch,
            extension,
            number,
            mobile,
            req.user.id
        );

        const contact = await db.get(
            `
            SELECT *
            FROM contacts
            WHERE id = ?
              AND user_id = ?
            `,
            result.lastID,
            req.user.id
        );

        res.status(201).json(contact);
    } catch (error) {
        console.error("CONTACT CREATE ERROR:", error);

        res.status(500).json({
            error: "Kontakt konnte nicht erstellt werden."
        });
    }
});

app.put("/api/contacts/:id", requireLogin, async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const branch = String(req.body.branch || "").trim();
        const extension = String(req.body.extension || "").trim();
        const number = String(req.body.number || "").trim();
        const mobile = String(req.body.mobile || "").trim();

        if (!name) {
            return res.status(400).json({
                error: "Name fehlt."
            });
        }

        if (!mobile && (!extension || !number)) {
            return res.status(400).json({
                error: "Ohne Mobilnummer müssen Durchwahl und Nummer angegeben werden."
            });
        }

        if (extension && !/^[0-9]{3}$/.test(extension)) {
            return res.status(400).json({
                error: "Die Durchwahl muss genau 3 Ziffern haben."
            });
        }

        if (number && !/^[0-9]{3}$/.test(number)) {
            return res.status(400).json({
                error: "Die Nummer muss genau 3 Ziffern haben."
            });
        }

        if (mobile && !/^[0-9]{1,20}$/.test(mobile)) {
            return res.status(400).json({
                error: "Die Mobilnummer darf nur Ziffern und maximal 20 Stellen enthalten."
            });
        }

        const result = await db.run(
            `
            UPDATE contacts
            SET
                name = ?,
                branch = ?,
                extension = ?,
                number = ?,
                mobile = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND user_id = ?
            `,
            name,
            branch,
            extension,
            number,
            mobile,
            req.params.id,
            req.user.id
        );

        if (result.changes === 0) {
            return res.status(404).json({
                error: "Kontakt nicht gefunden."
            });
        }

        const contact = await db.get(
            `
            SELECT *
            FROM contacts
            WHERE id = ?
              AND user_id = ?
            `,
            req.params.id,
            req.user.id
        );

        res.json(contact);
    } catch (error) {
        console.error("CONTACT UPDATE ERROR:", error);

        res.status(500).json({
            error: "Kontakt konnte nicht geändert werden."
        });
    }
});

app.delete("/api/contacts/:id", requireLogin, async (req, res) => {
    const result = await db.run(
        `
        DELETE FROM contacts
        WHERE id = ?
          AND user_id = ?
        `,
        req.params.id,
        req.user.id
    );

    if (result.changes === 0) {
        return res.status(404).json({
            error: "Kontakt nicht gefunden."
        });
    }

    res.json({
        success: true
    });
});

/* =========================================================
   EINSTELLUNGEN
========================================================= */

app.get("/api/settings", requireLogin, async (req, res) => {
    const settings = await db.get(
        `
        SELECT *
        FROM user_settings
        WHERE user_id = ?
        `,
        req.user.id
    );

    res.json(settings);
});

app.put("/api/settings", requireLogin, async (req, res) => {
    try {
        const body = req.body || {};

        const displayName = String(
            body.display_name ?? ""
        ).trim();

        const department = String(
            body.department ?? ""
        ).trim();

        const theme =
            body.theme === "black"
                ? "black"
                : "dark";

        const compactMode = body.compact_mode ? 1 : 0;

        const fontSize =
            ["small", "medium", "large"].includes(body.font_size)
                ? body.font_size
                : "medium";

        const defaultCategory =
            [
                "programme",
                "ablaeufe",
                "merke",
                "extras"
            ].includes(body.default_category)
                ? body.default_category
                : "programme";

        const noteSort =
            ["newest", "oldest", "title"].includes(body.note_sort)
                ? body.note_sort
                : "newest";

        const notesPerPage = Math.min(
            100,
            Math.max(
                5,
                Number(body.notes_per_page) || 20
            )
        );

        const contactSort =
            ["name", "branch"].includes(body.contact_sort)
                ? body.contact_sort
                : "name";

        const showBranch = body.show_branch ? 1 : 0;
        const notifications = body.notifications ? 1 : 0;
        const saveConfirmation = body.save_confirmation ? 1 : 0;
        const autoLogout = body.auto_logout ? 1 : 0;

        await db.run(
            `
            INSERT INTO user_settings (
                user_id,
                display_name,
                theme,
                compact_mode,
                department,
                font_size,
                default_category,
                note_sort,
                notes_per_page,
                contact_sort,
                show_branch,
                notifications,
                save_confirmation,
                auto_logout
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET
                display_name = excluded.display_name,
                theme = excluded.theme,
                compact_mode = excluded.compact_mode,
                department = excluded.department,
                font_size = excluded.font_size,
                default_category = excluded.default_category,
                note_sort = excluded.note_sort,
                notes_per_page = excluded.notes_per_page,
                contact_sort = excluded.contact_sort,
                show_branch = excluded.show_branch,
                notifications = excluded.notifications,
                save_confirmation = excluded.save_confirmation,
                auto_logout = excluded.auto_logout
            `,
            req.user.id,
            displayName,
            theme,
            compactMode,
            department,
            fontSize,
            defaultCategory,
            noteSort,
            notesPerPage,
            contactSort,
            showBranch,
            notifications,
            saveConfirmation,
            autoLogout
        );

        const settings = await db.get(
            `
            SELECT *
            FROM user_settings
            WHERE user_id = ?
            `,
            req.user.id
        );

        res.json(settings);
    } catch (error) {
        console.error("SETTINGS ERROR:", error);

        res.status(500).json({
            error: "Einstellungen konnten nicht gespeichert werden."
        });
    }
});

/* =========================================================
   EIGENES PASSWORT ÄNDERN
========================================================= */

app.put("/api/password", requireLogin, async (req, res) => {
    try {
        const currentPassword = String(req.body.currentPassword || "");
        const newPassword = String(req.body.newPassword || "");
        const newPasswordRepeat = String(req.body.newPasswordRepeat || "");

        if (!currentPassword) {
            return res.status(400).json({
                error: "Bitte gib dein aktuelles Passwort ein."
            });
        }

        if (!validatePassword(newPassword)) {
            return res.status(400).json({
                error: "Das neue Passwort muss mindestens 6 Zeichen lang sein."
            });
        }

        if (newPassword !== newPasswordRepeat) {
            return res.status(400).json({
                error: "Die neuen Passwörter stimmen nicht überein."
            });
        }

        const user = await db.get(
            `
            SELECT id, username, password_hash, must_set_password
            FROM users
            WHERE id = ?
            `,
            req.user.id
        );

        if (!user) {
            return res.status(404).json({
                error: "Benutzer nicht gefunden."
            });
        }

        const valid = await bcrypt.compare(
            currentPassword,
            user.password_hash
        );

        if (!valid) {
            return res.status(400).json({
                error: "Das aktuelle Passwort ist falsch."
            });
        }

        const hash = await bcrypt.hash(newPassword, 12);

        await db.run(
            `
            UPDATE users
            SET
                password_hash = ?,
                must_set_password = 0
            WHERE id = ?
            `,
            hash,
            user.id
        );

        res.json({
            success: true,
            message: "Passwort wurde erfolgreich geändert."
        });
    } catch (error) {
        console.error("PASSWORD CHANGE ERROR:", error);

        res.status(500).json({
            error: "Passwort konnte nicht geändert werden."
        });
    }
});

/* =========================================================
   ADMIN – BENUTZERÜBERSICHT
========================================================= */

app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
        const users = await db.all(`
            SELECT
                u.id,
                u.username,
                u.created_at,
                u.is_admin,
                u.must_set_password,
                (
                    SELECT COUNT(*)
                    FROM notes n
                    WHERE n.user_id = u.id
                ) AS note_count,
                (
                    SELECT COUNT(*)
                    FROM contacts c
                    WHERE c.user_id = u.id
                ) AS contact_count,
                COALESCE(s.display_name, '') AS display_name,
                COALESCE(s.department, '') AS department
            FROM users u
            LEFT JOIN user_settings s
                ON s.user_id = u.id
            ORDER BY
                u.is_admin DESC,
                u.username COLLATE NOCASE ASC
        `);

        res.json(users);
    } catch (error) {
        console.error("ADMIN USERS ERROR:", error);

        res.status(500).json({
            error: "Benutzer konnten nicht geladen werden."
        });
    }
});

/* =========================================================
   ADMIN – BENUTZER ANLEGEN
========================================================= */

app.post("/api/admin/users", requireAdmin, async (req, res) => {
    try {
        const username = normalizeUsername(req.body.username);

        if (!validateUsername(username)) {
            return res.status(400).json({
                error: "Ungültiger Benutzername. Erlaubt sind 2–30 Zeichen: Buchstaben, Zahlen, _ und -."
            });
        }

        const existing = await db.get(
            "SELECT id FROM users WHERE username = ?",
            username
        );

        if (existing) {
            return res.status(409).json({
                error: "Dieser Benutzername existiert bereits."
            });
        }

        /*
         * Es wird ein zufälliger, unbrauchbarer Passwort-Hash
         * gespeichert. Das echte Passwort wird erst beim
         * ersten Login vom Benutzer selbst gesetzt.
         */
        const unusablePassword = crypto.randomBytes(32).toString("hex");
        const passwordHash = await bcrypt.hash(
            unusablePassword,
            12
        );

        const result = await db.run(
            `
            INSERT INTO users
                (username, password_hash, is_admin, must_set_password)
            VALUES
                (?, ?, 0, 1)
            `,
            username,
            passwordHash
        );

        const userId = result.lastID;

        await db.run(
            `
            INSERT INTO user_settings
                (user_id, display_name, theme, compact_mode)
            VALUES
                (?, ?, 'dark', 0)
            `,
            userId,
            username
        );

        const user = await db.get(
            `
            SELECT
                id,
                username,
                created_at,
                is_admin,
                must_set_password
            FROM users
            WHERE id = ?
            `,
            userId
        );

        res.status(201).json(user);
    } catch (error) {
        console.error("ADMIN CREATE USER ERROR:", error);

        res.status(500).json({
            error: "Benutzer konnte nicht angelegt werden."
        });
    }
});

/* =========================================================
   ADMIN – BENUTZER LÖSCHEN
========================================================= */

app.delete(
    "/api/admin/users/:id",
    requireAdmin,
    async (req, res) => {
        try {
            const userId = Number(req.params.id);

            if (!Number.isInteger(userId)) {
                return res.status(400).json({
                    error: "Ungültige Benutzer-ID."
                });
            }

            if (userId === req.user.id) {
                return res.status(400).json({
                    error: "Der eigene Admin-Benutzer kann nicht gelöscht werden."
                });
            }

            const user = await db.get(
                "SELECT * FROM users WHERE id = ?",
                userId
            );

            if (!user) {
                return res.status(404).json({
                    error: "Benutzer nicht gefunden."
                });
            }

            if (Number(user.is_admin) === 1) {
                return res.status(403).json({
                    error: "Ein Admin-Benutzer kann nicht gelöscht werden."
                });
            }

            await db.run(
                "DELETE FROM notes WHERE user_id = ?",
                userId
            );

            await db.run(
                "DELETE FROM contacts WHERE user_id = ?",
                userId
            );

            await db.run(
                "DELETE FROM user_settings WHERE user_id = ?",
                userId
            );

            await db.run(
                "DELETE FROM users WHERE id = ?",
                userId
            );

            res.json({
                success: true
            });
        } catch (error) {
            console.error("ADMIN DELETE USER ERROR:", error);

            res.status(500).json({
                error: "Benutzer konnte nicht gelöscht werden."
            });
        }
    }
);

/* =========================================================
   ADMIN – PASSWORT ZURÜCKSETZEN
========================================================= */

app.post(
    "/api/admin/users/:id/reset-password",
    requireAdmin,
    async (req, res) => {
        try {
            const userId = Number(req.params.id);

            const user = await db.get(
                "SELECT * FROM users WHERE id = ?",
                userId
            );

            if (!user) {
                return res.status(404).json({
                    error: "Benutzer nicht gefunden."
                });
            }

            if (Number(user.is_admin) === 1) {
                return res.status(403).json({
                    error: "Das Admin-Passwort kann hier nicht zurückgesetzt werden."
                });
            }

            const temporaryPassword =
                createTemporaryPassword();

            const passwordHash = await bcrypt.hash(
                temporaryPassword,
                12
            );

            await db.run(
                `
                UPDATE users
                SET
                    password_hash = ?,
                    must_set_password = 0
                WHERE id = ?
                `,
                passwordHash,
                userId
            );

            /*
             * Das temporäre Passwort wird nur in dieser
             * API-Antwort zurückgegeben.
             */
            res.json({
                success: true,
                username: user.username,
                temporaryPassword
            });
        } catch (error) {
            console.error("ADMIN RESET PASSWORD ERROR:", error);

            res.status(500).json({
                error: "Passwort konnte nicht zurückgesetzt werden."
            });
        }
    }
);

/* =========================================================
   ADMIN – DATEN TEILEN
========================================================= */

app.post(
    "/api/admin/users/:id/share-data",
    requireAdmin,
    async (req, res) => {
        try {
            const targetUserId = Number(req.params.id);

            if (!Number.isInteger(targetUserId)) {
                return res.status(400).json({
                    error: "Ungültige Benutzer-ID."
                });
            }

            if (targetUserId === req.user.id) {
                return res.status(400).json({
                    error: "Die eigenen Daten müssen nicht geteilt werden."
                });
            }

            const targetUser = await db.get(
                `
                SELECT *
                FROM users
                WHERE id = ?
                `,
                targetUserId
            );

            if (!targetUser) {
                return res.status(404).json({
                    error: "Benutzer nicht gefunden."
                });
            }

            if (Number(targetUser.is_admin) === 1) {
                return res.status(403).json({
                    error: "Daten können nicht an einen Admin geteilt werden."
                });
            }

            /*
             * NOTIZEN KOPIEREN
             *
             * Bereits vorhandene identische Notizen werden
             * nicht doppelt angelegt.
             */
            const adminNotes = await db.all(
                `
                SELECT
                    title,
                    content,
                    category
                FROM notes
                WHERE user_id = ?
                `,
                req.user.id
            );

            let notesAdded = 0;

            for (const note of adminNotes) {
                const existing = await db.get(
                    `
                    SELECT id
                    FROM notes
                    WHERE user_id = ?
                      AND title = ?
                      AND content = ?
                      AND category = ?
                    LIMIT 1
                    `,
                    targetUserId,
                    note.title,
                    note.content,
                    note.category
                );

                if (!existing) {
                    await db.run(
                        `
                        INSERT INTO notes
                            (title, content, category, user_id)
                        VALUES
                            (?, ?, ?, ?)
                        `,
                        note.title,
                        note.content,
                        note.category,
                        targetUserId
                    );

                    notesAdded++;
                }
            }

            /*
             * KONTAKTE KOPIEREN
             */
            const adminContacts = await db.all(
                `
                SELECT
                    name,
                    branch,
                    extension,
                    number,
                    mobile
                FROM contacts
                WHERE user_id = ?
                `,
                req.user.id
            );

            let contactsAdded = 0;

            for (const contact of adminContacts) {
                const existing = await db.get(
                    `
                    SELECT id
                    FROM contacts
                    WHERE user_id = ?
                      AND name = ?
                      AND branch = ?
                      AND extension = ?
                      AND number = ?
                      AND mobile = ?
                    LIMIT 1
                    `,
                    targetUserId,
                    contact.name,
                    contact.branch,
                    contact.extension,
                    contact.number,
                    contact.mobile
                );

                if (!existing) {
                    await db.run(
                        `
                        INSERT INTO contacts
                            (name, branch, extension, number, mobile, user_id)
                        VALUES
                            (?, ?, ?, ?, ?, ?)
                        `,
                        contact.name,
                        contact.branch,
                        contact.extension,
                        contact.number,
                        contact.mobile,
                        targetUserId
                    );

                    contactsAdded++;
                }
            }

            res.json({
                success: true,
                notesAdded,
                contactsAdded
            });
        } catch (error) {
            console.error("ADMIN SHARE DATA ERROR:", error);

            res.status(500).json({
                error: "Daten konnten nicht geteilt werden."
            });
        }
    }
);

/* =========================================================
   APP ROUTE
========================================================= */

app.get("/app", async (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/");
    }

    res.sendFile(
        path.join(PUBLIC_DIR, "app.html")
    );
});

/* =========================================================
   SETUP ROUTE
========================================================= */

app.get("/setup", (req, res) => {
    res.sendFile(
        path.join(PUBLIC_DIR, "setup.html")
    );
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("========================================");
    console.log(" LAGER-NOTIZBUCH");
    console.log(" Server gestartet");
    console.log(` Port: ${PORT}`);
    console.log(` Admin: ${adminUsername}`);
    console.log("========================================");
    console.log("");
});
