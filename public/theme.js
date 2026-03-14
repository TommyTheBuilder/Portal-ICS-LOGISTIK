(function () {
  const THEME_KEY = "themePreference";

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("darkmode", isDark);
    const toggle = document.getElementById("themeToggleBtn");
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.title = isDark ? "Lightmode aktivieren" : "Darkmode aktivieren";
      toggle.textContent = isDark ? "☀️" : "🌙";
    }
  }

  function getAuthHeader() {
    const token = localStorage.getItem("token");
    if (!token) return {};
    return { "Authorization": "Bearer " + token };
  }

  async function persistTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    const authHeader = getAuthHeader();
    if (!authHeader.Authorization) return;

    try {
      await fetch("/api/theme", {
        credentials: "include",
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeader
        },
        body: JSON.stringify({ theme })
      });
    } catch {
      // Ignorieren: lokale Speicherung bleibt erhalten.
    }
  }

  async function resolveInitialTheme() {
    const localTheme = localStorage.getItem(THEME_KEY);
    if (localTheme === "dark" || localTheme === "light") {
      applyTheme(localTheme);
    }

    const authHeader = getAuthHeader();
    if (!authHeader.Authorization) {
      if (!localTheme) applyTheme("light");
      return;
    }

    try {
      const response = await fetch("/api/theme", {
        credentials: "include",
        headers: authHeader
      });
      if (!response.ok) return;
      const data = await response.json();
      const userTheme = (data && data.theme) === "dark" ? "dark" : "light";
      applyTheme(userTheme);
      localStorage.setItem(THEME_KEY, userTheme);
    } catch {
      if (!localTheme) applyTheme("light");
    }
  }

  function mountThemeToggle() {
    if (document.getElementById("themeToggleBtn")) return;
    const btn = document.createElement("button");
    btn.id = "themeToggleBtn";
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.setAttribute("aria-label", "Darkmode umschalten");
    btn.addEventListener("click", async () => {
      const nextTheme = document.body.classList.contains("darkmode") ? "light" : "dark";
      applyTheme(nextTheme);
      await persistTheme(nextTheme);
    });
    const mountTarget = document.getElementById("themeToggleMount");
    if (mountTarget) mountTarget.appendChild(btn);
    else document.body.appendChild(btn);
    applyTheme(localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      mountThemeToggle();
      void resolveInitialTheme();
    });
  } else {
    mountThemeToggle();
    void resolveInitialTheme();
  }
})();
