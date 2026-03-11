const err = document.getElementById("err");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const togglePasswordBtn = document.getElementById("togglePassword");

async function submitLogin() {
  err.textContent = "";
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Login fehlgeschlagen");

    localStorage.setItem("token", data.token);
    window.location.href = "/public/dashboard.html";
  } catch (e) {
    err.textContent = e.message;
  }
}

loginBtn.addEventListener("click", submitLogin);


if (togglePasswordBtn) {
  togglePasswordBtn.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    togglePasswordBtn.setAttribute("aria-pressed", String(isHidden));
    togglePasswordBtn.setAttribute("aria-label", isHidden ? "Passwort verbergen" : "Passwort anzeigen");
    togglePasswordBtn.textContent = isHidden ? "🙈" : "👁";
    passwordInput.focus();
  });
}

[usernameInput, passwordInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitLogin();
    }
  });
});
