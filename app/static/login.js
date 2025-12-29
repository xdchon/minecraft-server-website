const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");

async function checkExistingSession() {
  try {
    const response = await fetch("/auth/me");
    if (response.ok) {
      window.location = "/";
    }
  } catch (err) {
    // Ignore network errors on login screen.
  }
}

async function login(event) {
  event.preventDefault();
  loginError.textContent = "";
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  if (!username || !password) {
    loginError.textContent = "Enter your username and password.";
    return;
  }

  try {
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      loginError.textContent = payload.detail || "Login failed.";
      return;
    }
    window.location = "/";
  } catch (err) {
    loginError.textContent = "Unable to reach the server.";
  }
}

loginForm.addEventListener("submit", login);
checkExistingSession();
