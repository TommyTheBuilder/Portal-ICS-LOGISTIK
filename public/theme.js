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

  async function persistTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    try {
      await fetch("/api/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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

    try {
      const response = await fetch("/api/theme");
      if (!response.ok) return;
      const data = await response.json();
      const ipTheme = (data && data.theme) === "dark" ? "dark" : "light";
      applyTheme(ipTheme);
      localStorage.setItem(THEME_KEY, ipTheme);
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
