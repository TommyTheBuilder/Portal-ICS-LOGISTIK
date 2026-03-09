const err = document.getElementById("err");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");

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
    window.location.href = "/app.html";
  } catch (e) {
    err.textContent = e.message;
  }
}

loginBtn.addEventListener("click", submitLogin);

[usernameInput, passwordInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitLogin();
    }
  });
});
