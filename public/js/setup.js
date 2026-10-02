const form = document.getElementById("setupForm");
const usernameElement = document.getElementById("setupUsername");
const errorElement = document.getElementById("setupError");

async function loadSetupStatus() {
    try {
        const response = await fetch("/api/setup-status");

        const data = await response.json();

        if (!response.ok || !data.setup_required) {
            window.location.href = "/";
            return;
        }

        usernameElement.value = data.username;

    } catch (error) {
        errorElement.textContent =
            "Server nicht erreichbar.";
    }
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    errorElement.textContent = "";

    const password =
        document.getElementById("password").value;

    const passwordRepeat =
        document.getElementById("passwordRepeat").value;

    if (password.length < 6) {
        errorElement.textContent =
            "Das Passwort muss mindestens 6 Zeichen lang sein.";
        return;
    }

    if (password !== passwordRepeat) {
        errorElement.textContent =
            "Die Passwörter stimmen nicht überein.";
        return;
    }

    try {
        const response = await fetch(
            "/api/setup-password",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    password,
                    passwordRepeat
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            errorElement.textContent =
                data.error ||
                "Passwort konnte nicht festgelegt werden.";
            return;
        }

        window.location.href = "/app";

    } catch (error) {
        errorElement.textContent =
            "Server nicht erreichbar.";
    }
});

loadSetupStatus();
