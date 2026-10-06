const API_BASE_URL = "http://162.120.6.76:3000";
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
        input = API_BASE_URL + input;
        init.credentials = "include";
        const request = indexedDB.open("lager-notizbuch");
        const token = await new Promise(resolve => {
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("session")) return resolve(null);
                const tx = db.transaction("session", "readonly");
                const get = tx.objectStore("session").get("current-user");
                get.onsuccess = () => resolve(get.result?.token || null);
                get.onerror = () => resolve(null);
            };
            request.onerror = () => resolve(null);
        });
        init.headers = new Headers(init.headers || {});
        if (token) init.headers.set("Authorization", "Bearer " + token);
    }
    return originalFetch(input, init);
};
const menuCards = document.querySelectorAll(".menu-card");

const menuGrid = document.getElementById("menuGrid");
const welcome = document.getElementById("welcome");
const sectionView = document.getElementById("sectionView");
const sectionContent = document.getElementById("sectionContent");
const backButton = document.getElementById("backButton");
const usernameDisplay = document.getElementById("usernameDisplay");

let currentSection = null;
let currentNotes = [];
let currentContacts = [];

let editingNoteId = null;
let editingContactId = null;


/* =========================================
   BEREICHSNAMEN
   ========================================= */

const sectionNames = {
    programme: "Programme",
    telefonverzeichnis: "Telefonverzeichnis",
    ablaeufe: "Abläufe",
    merke: "Merke",
    extras: "Extras",
    einstellungen: "Einstellungen"
};


/* =========================================
   HTML SICHER DARSTELLEN
   ========================================= */

function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* =========================================
   LOGIN PRÜFEN
   ========================================= */

async function checkLogin() {

    try {

        const response = await fetch("/api/me", {
            method: "GET",
            credentials: "include",
            cache: "no-store"
        });

        if (!response.ok) {
            console.error(
                "API /api/me Fehler:",
                response.status
            );
            document.body.innerHTML = '<pre style="padding:20px">API /api/me STATUS: ' + response.status + '</pre>';
            return;
        }

        const user = await response.json();

        if (!user.authenticated) {
            console.error("Keine gültige Anmeldung.");
            window.location.href = "/";
            return;
        }

        console.log(
            "Angemeldet als:",
            user.username
        );

        /*
         * Benutzername nur setzen, wenn das Element
         * tatsächlich vorhanden ist.
         */
        if (usernameDisplay) {
            usernameDisplay.textContent =
                user.settings?.display_name ||
                user.username ||
                "";
        }

        /*
         * Einstellungen übernehmen.
         */
        if (user.settings?.theme) {
            document.body.dataset.theme =
                user.settings.theme;
        }

        document.body.classList.toggle(
            "compact-mode",
            !!user.settings?.compact_mode
        );

        if (
            user.settings?.font_size &&
            typeof applyFontSize === "function"
        ) {
            applyFontSize(
                user.settings.font_size
            );
        }

        if (
            user.settings?.auto_logout &&
            typeof startAutoLogoutTimer === "function"
        ) {
            startAutoLogoutTimer();
        }

    } catch (error) {

        console.error(
            "Fehler beim Login-Check:",
            error
        );

        /*
         * Nur echte Authentifizierungsfehler
         * dürfen zur Login-Seite führen.
         */
        window.location.href = "/";
    }
}

/* =========================================
   AUTOMATISCHE ABMELDUNG
   ========================================= */

let autoLogoutTimer = null;

function startAutoLogoutTimer() {

    if (autoLogoutTimer) {
        clearTimeout(autoLogoutTimer);
    }

    autoLogoutTimer = setTimeout(
        async () => {

            try {

                await fetch(
                    "/api/logout",
                    {
                        method: "POST"
                    }
                );

            } finally {

                window.location.href = "/";

            }

        },
        30 * 60 * 1000
    );
}


["click", "keydown", "mousemove", "touchstart", "scroll"].forEach(
    eventName => {

        document.addEventListener(
            eventName,
            () => {

                if (
                    settingsData &&
                    settingsData.auto_logout
                ) {
                    startAutoLogoutTimer();
                }

            },
            { passive: true }
        );

    }
);


/* =========================================
   BEREICH ÖFFNEN
   ========================================= */



async function openSection(section) {

    currentSection = section;

    menuGrid.classList.add("hidden");
    welcome.classList.add("hidden");
    sectionView.classList.remove("hidden");

    if (section === "telefonverzeichnis") {

        await renderContacts();

        return;
    }

    if (section === "einstellungen") {

        await renderSettings();

        return;
    }

    await renderNotes(section);
}


/* =========================================
   NOTIZBEREICH
   ========================================= */

async function renderNotes(category) {

    sectionContent.innerHTML = `

        <div class="section-heading">

            <div>

                <h2>
                    ${escapeHtml(sectionNames[category])}
                </h2>

                <p>
                    Einträge verwalten
                </p>

            </div>

            <button
                id="addNoteButton"
                class="primary-button"
                type="button"
            >
                + Eintrag hinzufügen
            </button>

        </div>


        <div class="search-box">

            <span class="search-icon">
                🔎
            </span>

            <input
                id="noteSearch"
                type="search"
                placeholder="Überschrift suchen..."
                autocomplete="off"
            >

        </div>


        <div
            id="notesList"
            class="notes-list"
        >

            <div class="loading">
                Lade Einträge...
            </div>

        </div>
    `;


    document
        .getElementById("addNoteButton")
        .addEventListener("click", () => {

            openNoteModal();

        });


    document
        .getElementById("noteSearch")
        .addEventListener("input", (event) => {

            renderNotesList(
                currentNotes,
                event.target.value
            );

        });


    try {

        const response = await fetch(
            `/api/notes?category=${encodeURIComponent(category)}`
        );

        if (!response.ok) {

            const error =
                await response.json().catch(() => ({}));

            throw new Error(
                error.error ||
                "Einträge konnten nicht geladen werden."
            );
        }

        currentNotes = await response.json();

        renderNotesList(currentNotes);

    } catch (error) {

        console.error(error);

        showError(error.message);

    }
}


/* =========================================
   NOTIZLISTE
   NUR ÜBERSCHRIFTEN
   ========================================= */

function renderNotesList(
    notes,
    searchTerm = ""
) {

    const list =
        document.getElementById("notesList");

    if (!list) {
        return;
    }


    const search =
        searchTerm.trim().toLowerCase();


    const filteredNotes =
        notes.filter((note) => {

            return note.title
                .toLowerCase()
                .includes(search);

        });


    if (!filteredNotes.length) {

        list.innerHTML = `

            <div class="empty-state">

                <div class="empty-icon">
                    ${search ? "🔎" : "+"}
                </div>

                <h3>
                    ${
                        search
                            ? "Keine Treffer"
                            : "Noch keine Einträge"
                    }
                </h3>

                <p>
                    ${
                        search
                            ? "Es wurde keine passende Überschrift gefunden."
                            : "Lege den ersten Eintrag an."
                    }
                </p>

            </div>
        `;

        return;
    }


    list.innerHTML =
        filteredNotes.map((note) => `

            <article
                class="note-title-card"
                data-note-open="${note.id}"
            >

                <div class="note-title-icon">
                    ›
                </div>

                <div class="note-title-text">

                    <h3>
                        ${escapeHtml(note.title)}
                    </h3>

                </div>

                <div class="note-title-arrow">
                    ›
                </div>

            </article>

        `).join("");


    document
        .querySelectorAll("[data-note-open]")
        .forEach((card) => {

            card.addEventListener("click", () => {

                const id =
                    Number(card.dataset.noteOpen);

                openNoteView(id);

            });

        });
}


/* =========================================
   EINZELNE NOTIZ ANZEIGEN
   ========================================= */

function openNoteView(id) {

    const note =
        currentNotes.find(
            (item) =>
                Number(item.id) === Number(id)
        );


    if (!note) {
        return;
    }


    sectionContent.innerHTML = `

        <div class="detail-topbar">

            <button
                id="noteBackButton"
                class="back-button"
                type="button"
            >
                ← Zurück
            </button>

        </div>


        <article class="note-detail">

            <div class="note-detail-header">

                <div>

                    <div class="detail-category">
                        ${escapeHtml(
                            sectionNames[currentSection]
                        )}
                    </div>

                    <h2>
                        ${escapeHtml(note.title)}
                    </h2>

                </div>


                <div class="data-card-actions">

                    <button
                        id="editCurrentNote"
                        class="small-button"
                        type="button"
                    >
                        Bearbeiten
                    </button>

                    <button
                        id="deleteCurrentNote"
                        class="small-button danger"
                        type="button"
                    >
                        Löschen
                    </button>

                </div>

            </div>


            <div class="note-detail-content">

                ${
                    note.content
                        ? escapeHtml(note.content)
                            .replaceAll("\n", "<br>")
                        : "<span class='muted-text'>Kein Text hinterlegt.</span>"
                }

            </div>

        </article>
    `;


    document
        .getElementById("noteBackButton")
        .addEventListener("click", () => {

            renderNotes(currentSection);

        });


    document
        .getElementById("editCurrentNote")
        .addEventListener("click", () => {

            openNoteModal(note);

        });


    document
        .getElementById("deleteCurrentNote")
        .addEventListener("click", async () => {

            await deleteNote(note.id);

        });
}


/* =========================================
   NOTIZ MODAL
   ========================================= */

function openNoteModal(note = null) {

    editingNoteId =
        note ? Number(note.id) : null;


    document.getElementById(
        "noteModalTitle"
    ).textContent =
        note
            ? "Eintrag bearbeiten"
            : "Eintrag hinzufügen";


    document.getElementById(
        "noteId"
    ).value =
        note?.id || "";


    document.getElementById(
        "noteTitle"
    ).value =
        note?.title || "";


    document.getElementById(
        "noteContent"
    ).value =
        note?.content || "";


    document
        .getElementById("noteModal")
        .classList.remove("hidden");


    document
        .getElementById("noteTitle")
        .focus();
}


/* =========================================
   NOTIZ SPEICHERN
   ========================================= */

document
    .getElementById("noteForm")
    .addEventListener("submit", async (event) => {

        event.preventDefault();


        const title =
            document
                .getElementById("noteTitle")
                .value
                .trim();


        const content =
            document
                .getElementById("noteContent")
                .value;


        if (!title) {

            alert(
                "Bitte eine Überschrift eingeben."
            );

            return;
        }


        const url =
            editingNoteId
                ? `/api/notes/${editingNoteId}`
                : "/api/notes";


        const method =
            editingNoteId
                ? "PUT"
                : "POST";


        try {

            const response =
                await fetch(url, {

                    method,

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({

                            category:
                                currentSection,

                            title,

                            content

                        })

                });


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "Speichern fehlgeschlagen."
                );
            }


            closeModal("noteModal");


            await renderNotes(
                currentSection
            );

        } catch (error) {

            console.error(error);

            alert(error.message);

        }

    });


/* =========================================
   NOTIZ LÖSCHEN
   ========================================= */

async function deleteNote(id) {

    const confirmed =
        confirm(
            "Diesen Eintrag wirklich löschen?"
        );


    if (!confirmed) {
        return;
    }


    try {

        const response =
            await fetch(
                `/api/notes/${id}`,
                {
                    method: "DELETE"
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Löschen fehlgeschlagen."
            );
        }


        await renderNotes(
            currentSection
        );

    } catch (error) {

        console.error(error);

        alert(error.message);

    }
}


/* =========================================
   TELEFONVERZEICHNIS
   ========================================= */

async function renderContacts() {

    sectionContent.innerHTML = `

        <div class="section-heading">

            <div>

                <h2>
                    Telefonverzeichnis
                </h2>

                <p>
                    Kontakte und interne Telefonnummern.
                </p>

            </div>

            <button
                id="addContactButton"
                class="primary-button"
                type="button"
            >
                + Kontakt hinzufügen
            </button>

        </div>


        <div class="search-box">

            <span class="search-icon">
                🔎
            </span>

            <input
                id="contactSearch"
                type="search"
                placeholder="Name, Filiale oder Nummer suchen..."
                autocomplete="off"
            >

        </div>


        <div
            id="contactsList"
            class="contacts-list"
        >

            <div class="loading">
                Lade Kontakte...
            </div>

        </div>
    `;


    document
        .getElementById("addContactButton")
        .addEventListener("click", () => {

            openContactModal();

        });


    document
        .getElementById("contactSearch")
        .addEventListener("input", (event) => {

            renderContactsList(
                currentContacts,
                event.target.value
            );

        });


    try {

        const response =
            await fetch("/api/contacts");


        if (!response.ok) {

            const error =
                await response.json().catch(() => ({}));

            throw new Error(
                error.error ||
                "Telefonverzeichnis konnte nicht geladen werden."
            );
        }


        currentContacts =
            await response.json();


        renderContactsList(
            currentContacts
        );

    } catch (error) {

        console.error(error);

        showError(error.message);

    }
}


/* =========================================
   KONTAKTE RENDERN
   ========================================= */

function renderContactsList(
    contacts,
    searchTerm = ""
) {

    const list =
        document.getElementById(
            "contactsList"
        );


    if (!list) {
        return;
    }


    const search =
        searchTerm.trim().toLowerCase();


    const filtered =
        contacts.filter((contact) => {

            const searchable = [

                contact.name,
                contact.branch,
                contact.extension,
                contact.number,
                contact.mobile

            ]
                .join(" ")
                .toLowerCase();


            return searchable.includes(search);

        });


    if (!filtered.length) {

        list.innerHTML = `

            <div class="empty-state">

                <div class="empty-icon">
                    ${search ? "🔎" : "☎"}
                </div>

                <h3>
                    ${
                        search
                            ? "Keine Treffer"
                            : "Noch keine Kontakte"
                    }
                </h3>

                <p>
                    ${
                        search
                            ? "Kein passender Kontakt gefunden."
                            : "Lege den ersten Kontakt an."
                    }
                </p>

            </div>
        `;

        return;
    }


    list.innerHTML =
        filtered.map((contact) => `

            <article
                class="contact-card"
            >

                <div class="contact-main">

                    <h3>
                        ${escapeHtml(contact.name)}
                    </h3>

                    ${
                        contact.branch
                            ? `
                                <span class="contact-branch">
                                    ${escapeHtml(contact.branch)}
                                </span>
                            `
                            : ""
                    }

                </div>


                <div class="contact-number">

                    <div>

                        <span>
                            Durchwahl
                        </span>

                        <strong>
                            ${escapeHtml(
                                contact.extension
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Nummer
                        </span>

                        <strong>
                            ${escapeHtml(
                                contact.number
                            )}
                        </strong>

                    </div>


                    ${
                        contact.mobile
                            ? `
                                <div>

                                    <span>
                                        Mobil
                                    </span>

                                    <strong>
                                        ${escapeHtml(
                                            contact.mobile
                                        )}
                                    </strong>

                                </div>
                            `
                            : ""
                    }

                </div>


                <div class="data-card-actions">

                    <button
                        class="small-button"
                        type="button"
                        data-edit-contact="${contact.id}"
                    >
                        Bearbeiten
                    </button>

                    <button
                        class="small-button danger"
                        type="button"
                        data-delete-contact="${contact.id}"
                    >
                        Löschen
                    </button>

                </div>

            </article>

        `).join("");


    document
        .querySelectorAll(
            "[data-edit-contact]"
        )
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {

                    const id =
                        Number(
                            button.dataset.editContact
                        );


                    const contact =
                        currentContacts.find(
                            (item) =>
                                Number(item.id) === id
                        );


                    if (contact) {
                        openContactModal(contact);
                    }

                }
            );

        });


    document
        .querySelectorAll(
            "[data-delete-contact]"
        )
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {

                    deleteContact(
                        Number(
                            button.dataset.deleteContact
                        )
                    );

                }
            );

        });
}


/* =========================================
   KONTAKT MODAL
   ========================================= */

function openContactModal(
    contact = null
) {

    editingContactId =
        contact
            ? Number(contact.id)
            : null;


    document.getElementById(
        "contactModalTitle"
    ).textContent =
        contact
            ? "Kontakt bearbeiten"
            : "Kontakt hinzufügen";


    document.getElementById(
        "contactId"
    ).value =
        contact?.id || "";


    document.getElementById(
        "contactName"
    ).value =
        contact?.name || "";


    document.getElementById(
        "contactBranch"
    ).value =
        contact?.branch || "";


    document.getElementById(
        "contactExtension"
    ).value =
        contact?.extension || "";


    document.getElementById(
        "contactNumber"
    ).value =
        contact?.number || "";


    document.getElementById(
        "contactMobile"
    ).value =
        contact?.mobile || "";


    document
        .getElementById("contactModal")
        .classList.remove("hidden");


    document
        .getElementById("contactName")
        .focus();
}


/* =========================================
   KONTAKT SPEICHERN
   ========================================= */

document
    .getElementById("contactForm")
    .addEventListener("submit", async (event) => {

        event.preventDefault();


        const data = {

            name:
                document
                    .getElementById("contactName")
                    .value
                    .trim(),

            branch:
                document
                    .getElementById("contactBranch")
                    .value
                    .trim(),

            extension:
                document
                    .getElementById("contactExtension")
                    .value
                    .trim(),

            number:
                document
                    .getElementById("contactNumber")
                    .value
                    .trim(),

            mobile:
                document
                    .getElementById("contactMobile")
                    .value
                    .trim()

        };


        if (!data.name) {

            alert("Bitte einen Namen eingeben.");

            return;
        }


        if (!/^\d{3}$/.test(data.extension)) {

            alert(
                "Die Durchwahl muss genau 3 Ziffern haben."
            );

            return;
        }


        if (!/^\d{3}$/.test(data.number)) {

            alert(
                "Die Nummer muss genau 3 Ziffern haben."
            );

            return;
        }


        if (
            data.mobile &&
            !/^\d{1,20}$/.test(data.mobile)
        ) {

            alert(
                "Die Mobilnummer darf maximal 20 Ziffern enthalten."
            );

            return;
        }


        const url =
            editingContactId
                ? `/api/contacts/${editingContactId}`
                : "/api/contacts";


        const method =
            editingContactId
                ? "PUT"
                : "POST";


        try {

            const response =
                await fetch(url, {

                    method,

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(data)

                });


            const result =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    result.error ||
                    "Kontakt konnte nicht gespeichert werden."
                );
            }


            closeModal("contactModal");


            await renderContacts();

        } catch (error) {

            console.error(error);

            alert(error.message);

        }

    });


/* =========================================
   KONTAKT LÖSCHEN
   ========================================= */

async function deleteContact(id) {

    const confirmed =
        confirm(
            "Diesen Kontakt wirklich löschen?"
        );


    if (!confirmed) {
        return;
    }


    try {

        const response =
            await fetch(
                `/api/contacts/${id}`,
                {
                    method: "DELETE"
                }
            );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.error ||
                "Kontakt konnte nicht gelöscht werden."
            );
        }


        await renderContacts();

    } catch (error) {

        console.error(error);

        alert(error.message);

    }
}


/* =========================================
   EINSTELLUNGEN
   ========================================= */


/* =========================================
   BENUTZERVERWALTUNG – ADMIN
   ========================================= */

async function renderUserManagement() {

    sectionContent.innerHTML = `
        <div class="section-heading">
            <div>
                <h2>Benutzerverwaltung</h2>
                <p>Benutzer anlegen und deren Zugriff verwalten.</p>
            </div>

            <button
                id="addUserButton"
                class="primary-button"
                type="button"
            >
                + Benutzer anlegen
            </button>
        </div>

        <div id="adminUserMessage"></div>

        <div
            id="adminUsersList"
            class="admin-users-list"
        >
            <div class="loading">
                Lade Benutzer...
            </div>
        </div>
    `;

    document
        .getElementById("addUserButton")
        .addEventListener("click", showCreateUserDialog);

    await loadAdminUsers();
}


/* =========================================
   BENUTZER LADEN
   ========================================= */

async function loadAdminUsers() {

    const list =
        document.getElementById("adminUsersList");

    if (!list) {
        return;
    }

    try {

        const response =
            await fetch("/api/admin/users");

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Benutzer konnten nicht geladen werden."
            );
        }

        if (!data.length) {

            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">👥</div>
                    <h3>Noch keine Benutzer</h3>
                    <p>Lege den ersten Benutzer an.</p>
                </div>
            `;

            return;
        }

        list.innerHTML = data.map(user => {

            const isAdmin =
                Number(user.is_admin) === 1;

            const needsPassword =
                Number(user.must_set_password) === 1;

            return `
                <article
                    class="admin-user-card ${
                        isAdmin
                            ? "admin-user-card-admin"
                            : ""
                    }"
                >

                    <div class="admin-user-info">

                        <div class="admin-user-avatar">
                            ${
                                isAdmin
                                    ? "👑"
                                    : "👤"
                            }
                        </div>

                        <div>

                            <h3>
                                ${escapeHtml(user.username)}
                            </h3>

                            <p>
                                ${
                                    isAdmin
                                        ? "Administrator"
                                        : (
                                            user.display_name
                                                ? escapeHtml(
                                                    user.display_name
                                                )
                                                : "Normaler Benutzer"
                                        )
                                }
                            </p>

                            ${
                                user.department
                                    ? `
                                        <span class="admin-user-meta">
                                            ${escapeHtml(
                                                user.department
                                            )}
                                        </span>
                                    `
                                    : ""
                            }

                            <div class="admin-user-stats">
                                📝 ${user.note_count} Notizen
                                &nbsp; · &nbsp;
                                ☎ ${user.contact_count} Kontakte
                            </div>

                            ${
                                needsPassword
                                    ? `
                                        <div class="admin-user-warning">
                                            ⚠ Passwort noch nicht eingerichtet
                                        </div>
                                    `
                                    : ""
                            }

                        </div>

                    </div>

                    ${
                        !isAdmin
                            ? `
                                <button
                                    type="button"
                                    class="secondary-button admin-user-open"
                                    data-user-id="${user.id}"
                                >
                                    Verwalten
                                </button>
                            `
                            : `
                                <span class="admin-badge">
                                    ADMIN
                                </span>
                            `
                    }

                </article>
            `;

        }).join("");

        list
            .querySelectorAll(".admin-user-open")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {
                        const userId =
                            Number(
                                button.dataset.userId
                            );

                        openUserManagement(userId);
                    }
                );

            });

    } catch (error) {

        console.error(error);

        list.innerHTML = `
            <div class="error-box">
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}


/* =========================================
   NEUEN BENUTZER ANLEGEN
   ========================================= */

async function showCreateUserDialog() {

    const username = prompt(
        "Kurzzeichen / Benutzername des neuen Benutzers:"
    );

    if (username === null) {
        return;
    }

    const cleanUsername =
        username.trim();

    if (!cleanUsername) {
        alert("Bitte einen Benutzernamen eingeben.");
        return;
    }

    try {

        const response =
            await fetch(
                "/api/admin/users",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        username: cleanUsername
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Benutzer konnte nicht angelegt werden."
            );
        }

        alert(
            `Benutzer ${data.username} wurde angelegt.\n\n` +
            `Der Benutzer kann sich jetzt mit seinem ` +
            `Benutzernamen anmelden und anschließend ` +
            `sein eigenes Passwort festlegen.`
        );

        await loadAdminUsers();

    } catch (error) {

        console.error(error);

        alert(error.message);
    }
}


/* =========================================
   BENUTZER VERWALTEN
   ========================================= */

async function openUserManagement(userId) {

    try {

        const response =
            await fetch("/api/admin/users");

        const users =
            await response.json();

        if (!response.ok) {
            throw new Error(
                users.error ||
                "Benutzer konnten nicht geladen werden."
            );
        }

        const user =
            users.find(
                item =>
                    Number(item.id) ===
                    Number(userId)
            );

        if (!user) {
            throw new Error(
                "Benutzer nicht gefunden."
            );
        }

        sectionContent.innerHTML = `

            <div class="section-heading">

                <div>

                    <button
                        id="backToUsers"
                        class="back-small-button"
                        type="button"
                    >
                        ← Benutzer
                    </button>

                    <h2>
                        ${escapeHtml(user.username)}
                    </h2>

                    <p>
                        Benutzerverwaltung
                    </p>

                </div>

            </div>


            <div class="user-management-grid">


                <div class="settings-card">

                    <div class="management-icon">
                        📦
                    </div>

                    <h3>
                        Daten teilen
                    </h3>

                    <p>
                        Kopiert deine Notizen und dein
                        Telefonverzeichnis zu diesem Benutzer.
                    </p>

                    <p class="settings-hint">
                        Bereits vorhandene identische
                        Einträge werden nicht doppelt angelegt.
                    </p>

                    <button
                        id="shareUserData"
                        class="primary-button"
                        type="button"
                    >
                        Meine Daten teilen
                    </button>

                </div>


                <div class="settings-card">

                    <div class="management-icon">
                        🔑
                    </div>

                    <h3>
                        Passwort zurücksetzen
                    </h3>

                    <p>
                        Erstellt ein neues temporäres Passwort.
                    </p>

                    <p class="settings-hint">
                        Das Passwort wird nur einmal angezeigt.
                    </p>

                    <button
                        id="resetUserPassword"
                        class="secondary-button"
                        type="button"
                    >
                        Passwort zurücksetzen
                    </button>

                    <div
                        id="temporaryPasswordBox"
                        class="temporary-password-box"
                        style="display:none;"
                    ></div>

                </div>


                <div class="settings-card danger-card">

                    <div class="management-icon">
                        🗑️
                    </div>

                    <h3>
                        Benutzer löschen
                    </h3>

                    <p>
                        Löscht den Benutzer sowie seine
                        persönlichen Notizen und Kontakte.
                    </p>

                    <button
                        id="deleteManagedUser"
                        class="danger-button"
                        type="button"
                    >
                        Benutzer endgültig löschen
                    </button>

                </div>

            </div>
        `;


        document
            .getElementById("backToUsers")
            .addEventListener(
                "click",
                renderUserManagement
            );


        document
            .getElementById("shareUserData")
            .addEventListener(
                "click",
                () => shareUserData(user)
            );


        document
            .getElementById("resetUserPassword")
            .addEventListener(
                "click",
                () => resetUserPassword(user)
            );


        document
            .getElementById("deleteManagedUser")
            .addEventListener(
                "click",
                () => deleteManagedUser(user)
            );

    } catch (error) {

        console.error(error);

        alert(error.message);
    }
}


/* =========================================
   DATEN TEILEN
   ========================================= */

async function shareUserData(user) {

    const confirmed =
        confirm(
            `Deine Notizen und dein Telefonverzeichnis ` +
            `an "${user.username}" kopieren?`
        );

    if (!confirmed) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/admin/users/${user.id}/share-data`,
                {
                    method: "POST"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Daten konnten nicht geteilt werden."
            );
        }

        alert(
            `Daten wurden geteilt.\n\n` +
            `Neue Notizen: ${data.notesAdded}\n` +
            `Neue Kontakte: ${data.contactsAdded}`
        );

        await openUserManagement(user.id);

    } catch (error) {

        console.error(error);

        alert(error.message);
    }
}


/* =========================================
   PASSWORT ZURÜCKSETZEN
   ========================================= */

async function resetUserPassword(user) {

    const confirmed =
        confirm(
            `Für "${user.username}" wirklich ` +
            `ein neues Passwort erzeugen?`
        );

    if (!confirmed) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/admin/users/${user.id}/reset-password`,
                {
                    method: "POST"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Passwort konnte nicht zurückgesetzt werden."
            );
        }

        const box =
            document.getElementById(
                "temporaryPasswordBox"
            );

        box.style.display = "block";

        box.innerHTML = `
            <strong>
                Neues temporäres Passwort
            </strong>

            <div class="temporary-password">
                ${escapeHtml(
                    data.temporaryPassword
                )}
            </div>

            <small>
                Bitte sicher an den Benutzer weitergeben.
                Dieses Passwort wird nicht erneut angezeigt.
            </small>
        `;

    } catch (error) {

        console.error(error);

        alert(error.message);
    }
}


/* =========================================
   BENUTZER LÖSCHEN
   ========================================= */

async function deleteManagedUser(user) {

    const confirmed =
        confirm(
            `ACHTUNG!\n\n` +
            `Der Benutzer "${user.username}" wird ` +
            `endgültig gelöscht.\n\n` +
            `Auch seine persönlichen Notizen und ` +
            `Kontakte werden gelöscht.\n\n` +
            `Wirklich fortfahren?`
        );

    if (!confirmed) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/admin/users/${user.id}`,
                {
                    method: "DELETE"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Benutzer konnte nicht gelöscht werden."
            );
        }

        alert(
            `Benutzer "${user.username}" wurde gelöscht.`
        );

        await renderUserManagement();

    } catch (error) {

        console.error(error);

        alert(error.message);
    }
}


/* =========================================
   EINSTELLUNGEN
   ========================================= */

async function renderSettings() {

    try {

        const response =
            await fetch("/api/settings");

        if (!response.ok) {
            throw new Error(
                "Einstellungen konnten nicht geladen werden."
            );
        }

        const settings =
            await response.json();

        /*
         * Prüfen, ob der aktuelle Benutzer Admin ist.
         */
        const meResponse =
            await fetch("/api/me");

        const me =
            await meResponse.json();

        sectionContent.innerHTML = `

            <div class="section-heading">

                <div>

                    <h2>
                        Einstellungen
                    </h2>

                    <p>
                        Persönliche und optische Einstellungen
                    </p>

                </div>

            </div>


            <div class="settings-grid">


                <div class="settings-card">

                    <h3>
                        Benutzer
                    </h3>

                    <label>
                        Angezeigter Name
                    </label>

                    <input
                        id="displayName"
                        type="text"
                        maxlength="100"
                        value="${escapeHtml(
                            settings.display_name || ""
                        )}"
                    >

                    <label>
                        Abteilung / Bereich
                    </label>

                    <input
                        id="department"
                        type="text"
                        maxlength="100"
                        value="${escapeHtml(
                            settings.department || ""
                        )}"
                    >

                    <button
                        id="saveSettings"
                        class="primary-button"
                        type="button"
                    >
                        Einstellungen speichern
                    </button>

                </div>


                <div class="settings-card">

                    <h3>
                        Darstellung
                    </h3>

                    <label class="checkbox-label">

                        <input
                            id="compactMode"
                            type="checkbox"
                            ${
                                settings.compact_mode
                                    ? "checked"
                                    : ""
                            }
                        >

                        Kompakte Darstellung

                    </label>


                    <label for="theme">
                        Farbdarstellung
                    </label>

                    <select id="theme">

                        <option
                            value="dark"
                            ${
                                settings.theme === "dark"
                                    ? "selected"
                                    : ""
                            }
                        >
                            Dunkelblau
                        </option>

                        <option
                            value="black"
                            ${
                                settings.theme === "black"
                                    ? "selected"
                                    : ""
                            }
                        >
                            Schwarz
                        </option>

                    </select>


                    <label for="fontSize">
                        Schriftgröße
                    </label>

                    <select id="fontSize">

                        <option
                            value="small"
                            ${
                                settings.font_size === "small"
                                    ? "selected"
                                    : ""
                            }
                        >
                            Klein
                        </option>

                        <option
                            value="medium"
                            ${
                                settings.font_size === "medium"
                                    ? "selected"
                                    : ""
                            }
                        >
                            Mittel
                        </option>

                        <option
                            value="large"
                            ${
                                settings.font_size === "large"
                                    ? "selected"
                                    : ""
                            }
                        >
                            Groß
                        </option>

                    </select>

                </div>


                <div class="settings-card">

                    <h3>
                        Notizen
                    </h3>

                    <label for="defaultCategory">
                        Standard-Kategorie
                    </label>

                    <select id="defaultCategory">

                        <option value="programme">
                            Programme
                        </option>

                        <option value="ablaeufe">
                            Abläufe
                        </option>

                        <option value="merke">
                            Merke
                        </option>

                        <option value="extras">
                            Extras
                        </option>

                    </select>


                    <label for="noteSort">
                        Sortierung
                    </label>

                    <select id="noteSort">

                        <option value="newest">
                            Neueste zuerst
                        </option>

                        <option value="oldest">
                            Älteste zuerst
                        </option>

                        <option value="title">
                            Nach Titel
                        </option>

                    </select>


                    <label for="notesPerPage">
                        Notizen pro Seite
                    </label>

                    <select id="notesPerPage">

                        <option value="10">10</option>
                        <option value="20">20</option>
                        <option value="50">50</option>
                        <option value="100">100</option>

                    </select>

                </div>


                <div class="settings-card">

                    <h3>
                        Telefonverzeichnis
                    </h3>

                    <label for="contactSort">
                        Sortierung
                    </label>

                    <select id="contactSort">

                        <option value="name">
                            Nach Name
                        </option>

                        <option value="branch">
                            Nach Filiale
                        </option>

                    </select>


                    <label class="checkbox-label">

                        <input
                            id="showBranch"
                            type="checkbox"
                            ${
                                settings.show_branch
                                    ? "checked"
                                    : ""
                            }
                        >

                        Filiale anzeigen

                    </label>

                </div>


                <div class="settings-card">

                    <h3>
                        Verhalten
                    </h3>

                    <label class="checkbox-label">

                        <input
                            id="notifications"
                            type="checkbox"
                            ${
                                settings.notifications
                                    ? "checked"
                                    : ""
                            }
                        >

                        Benachrichtigungen

                    </label>


                    <label class="checkbox-label">

                        <input
                            id="saveConfirmation"
                            type="checkbox"
                            ${
                                settings.save_confirmation
                                    ? "checked"
                                    : ""
                            }
                        >

                        Speicherbestätigung

                    </label>


                    <label class="checkbox-label">

                        <input
                            id="autoLogout"
                            type="checkbox"
                            ${
                                settings.auto_logout
                                    ? "checked"
                                    : ""
                            }
                        >

                        Automatische Abmeldung

                    </label>

                </div>


                ${
                    me.is_admin
                        ? `
                            <div
                                class="settings-card admin-settings-card"
                            >

                                <div class="admin-settings-header">

                                    <div class="management-icon">
                                        👥
                                    </div>

                                    <div>

                                        <h3>
                                            Benutzerverwaltung
                                        </h3>

                                        <p>
                                            Benutzer anlegen und
                                            verwalten.
                                        </p>

                                    </div>

                                </div>

                                <button
                                    id="openUserManagement"
                                    class="primary-button"
                                    type="button"
                                >
                                    Benutzerverwaltung öffnen
                                </button>

                            </div>
                        `
                        : ""
                }


                <div class="settings-card">

                    <h3>
                        Passwort ändern
                    </h3>

                    <label>
                        Aktuelles Passwort
                    </label>

                    <input
                        id="currentPassword"
                        type="password"
                        autocomplete="current-password"
                    >


                    <label>
                        Neues Passwort
                    </label>

                    <input
                        id="newPassword"
                        type="password"
                        minlength="6"
                        autocomplete="new-password"
                    >


                    <label>
                        Neues Passwort wiederholen
                    </label>

                    <input
                        id="newPasswordRepeat"
                        type="password"
                        minlength="6"
                        autocomplete="new-password"
                    >


                    <button
                        id="changePassword"
                        class="primary-button"
                        type="button"
                    >
                        Passwort ändern
                    </button>

                </div>

            </div>
        `;


        /*
         * Werte in Select-Felder setzen
         */

        const defaultCategory =
            document.getElementById(
                "defaultCategory"
            );

        if (defaultCategory) {
            defaultCategory.value =
                settings.default_category ||
                "programme";
        }


        const noteSort =
            document.getElementById("noteSort");

        if (noteSort) {
            noteSort.value =
                settings.note_sort ||
                "newest";
        }


        const notesPerPage =
            document.getElementById("notesPerPage");

        if (notesPerPage) {
            notesPerPage.value =
                String(
                    settings.notes_per_page || 20
                );
        }


        const contactSort =
            document.getElementById("contactSort");

        if (contactSort) {
            contactSort.value =
                settings.contact_sort ||
                "name";
        }


        document
            .getElementById("saveSettings")
            .addEventListener(
                "click",
                saveSettings
            );


        document
            .getElementById("changePassword")
            .addEventListener(
                "click",
                changePassword
            );


        document
            .getElementById("compactMode")
            .addEventListener(
                "change",
                () => {

                    document.body.classList.toggle(
                        "compact-mode",
                        document
                            .getElementById("compactMode")
                            .checked
                    );

                }
            );


        const adminButton =
            document.getElementById(
                "openUserManagement"
            );

        if (adminButton) {

            adminButton.addEventListener(
                "click",
                renderUserManagement
            );

        }

    } catch (error) {

        console.error(error);

        showError(error.message);
    }
}


async function saveSettings() {

    const data = {

        display_name:
            document
                .getElementById("displayName")
                .value
                .trim(),

        department:
            document
                .getElementById("department")
                .value
                .trim(),

        compact_mode:
            document
                .getElementById("compactMode")
                .checked,

        theme:
            document
                .getElementById("theme")
                .value,

        font_size:
            document
                .getElementById("fontSize")
                .value,

        default_category:
            document
                .getElementById("defaultCategory")
                .value,

        note_sort:
            document
                .getElementById("noteSort")
                .value,

        notes_per_page:
            Number(
                document
                    .getElementById("notesPerPage")
                    .value
            ),

        contact_sort:
            document
                .getElementById("contactSort")
                .value,

        show_branch:
            document
                .getElementById("showBranch")
                .checked,

        notifications:
            document
                .getElementById("notifications")
                .checked,

        save_confirmation:
            document
                .getElementById("saveConfirmation")
                .checked,

        auto_logout:
            document
                .getElementById("autoLogout")
                .checked
    };


    try {

        const response =
            await fetch(
                "/api/settings",
                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(data)
                }
            );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.error ||
                "Einstellungen konnten nicht gespeichert werden."
            );
        }


        usernameDisplay.textContent =
            data.display_name ||
            usernameDisplay.textContent;


        document.body.dataset.theme =
            data.theme;


        document.body.classList.toggle(
            "compact-mode",
            data.compact_mode
        );


        alert(
            "Einstellungen gespeichert."
        );


    } catch (error) {

        console.error(error);

        alert(error.message);
    }
}


async function changePassword() {
    const currentPassword =
        document.getElementById("currentPassword").value;

    const newPassword =
        document.getElementById("newPassword").value;

    const newPasswordRepeat =
        document.getElementById("newPasswordRepeat").value;

    if (!currentPassword || !newPassword || !newPasswordRepeat) {
        alert("Bitte alle Passwortfelder ausfüllen.");
        return;
    }

    if (newPassword.length < 6) {
        alert("Das neue Passwort muss mindestens 6 Zeichen lang sein.");
        return;
    }

    if (newPassword !== newPasswordRepeat) {
        alert("Die neuen Passwörter stimmen nicht überein.");
        return;
    }

    try {
        const response = await fetch("/api/password", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                currentPassword,
                newPassword,
                newPasswordRepeat
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.error ||
                "Passwort konnte nicht geändert werden."
            );
        }

        document.getElementById("currentPassword").value = "";
        document.getElementById("newPassword").value = "";
        document.getElementById("newPasswordRepeat").value = "";

        alert("Passwort wurde erfolgreich geändert.");

    } catch (error) {
        console.error("PASSWORT ÄNDERN:", error);
        alert(error.message);
    }
}

/* =========================================
   MODAL SCHLIESSEN
   ========================================= */

document
    .querySelectorAll("[data-close]")
    .forEach((button) => {

        button.addEventListener(
            "click",
            () => {

                closeModal(
                    button.dataset.close
                );

            }
        );

    });


function closeModal(id) {

    const modal =
        document.getElementById(id);

    if (modal) {
        modal.classList.add("hidden");
    }
}


/* =========================================
   ZURÜCK ZUM STARTMENÜ
   ========================================= */

backButton.addEventListener(
    "click",
    () => {

        sectionView.classList.add("hidden");

        menuGrid.classList.remove("hidden");

        welcome.classList.remove("hidden");

        currentSection = null;

    }
);


/* =========================================
   MENÜ
   ========================================= */

menuCards.forEach((card) => {

    card.addEventListener(
        "click",
        () => {

            const section =
                card.dataset.section;

            console.log(
                "Öffne Bereich:",
                section
            );

            openSection(section);

        }
    );

});


/* =========================================
   FEHLERANZEIGE
   ========================================= */

function showError(message) {

    sectionContent.innerHTML = `

        <div class="error-box">
            ${escapeHtml(message)}
        </div>
    `;
}


/* =========================================
   LOGOUT
   ========================================= */

document
    .getElementById("logout")
    .addEventListener(
        "click",
        async () => {

            await fetch(
                "/api/logout",
                {
                    method: "POST"
                }
            );

            window.location.href = "/";

        }
    );


/* =========================================
   START
   ========================================= */

checkLogin();
