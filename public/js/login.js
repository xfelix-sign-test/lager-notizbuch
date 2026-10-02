const API_BASE_URL = "http://162.120.6.76:3000";

const form = document.getElementById("loginForm");
const errorElement = document.getElementById("error");

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorElement.textContent = "";

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username) {
        errorElement.textContent = "Bitte Benutzernamen eingeben.";
        return;
    }

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
                data.error || "Anmeldung fehlgeschlagen.";
            return;
        }

        if (data.setup_required) {
            window.location.href = API_BASE_URL + "/setup";
            return;
        }

        window.location.href = API_BASE_URL + "/app";

    } catch (error) {
        errorElement.textContent = "Server nicht erreichbar.";
    }
});
