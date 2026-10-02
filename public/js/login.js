const form = document.getElementById("loginForm");
const errorElement = document.getElementById("error");

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

    try {
        const response = await fetch(
            "/api/login",
            {
                method: "POST",
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

        /*
         * Neuer Benutzer:
         * Passwort muss erst eingerichtet werden.
         */
        if (data.setup_required) {
            window.location.href = "/setup";
            return;
        }

        window.location.href = "/app";

    } catch (error) {
        errorElement.textContent =
            "Server nicht erreichbar.";
    }
});
