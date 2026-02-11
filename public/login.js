const err = document.getElementById("err");

document.getElementById("loginBtn").addEventListener("click", async () => {
  err.textContent = "";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

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
});
