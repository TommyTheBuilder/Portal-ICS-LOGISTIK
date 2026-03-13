let token = localStorage.getItem("token");

function $(id) { return document.getElementById(id); }

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": "Bearer " + token } : {}),
      ...(opts.headers || {})
    }
  });
}

function setMsg(elId, text, ok = false) {
  const el = $(elId);
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

function showPasswordModal(show) {
  const back = $("passwordModalBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
}

function closeSettingsMenu() {
  const menu = $("settingsMenu");
  const trigger = $("settingsTriggerBtn");
  if (!menu || !trigger) return;
  menu.classList.remove("open");
  trigger.setAttribute("aria-expanded", "false");
}

function openSettingsMenu() {
  const menu = $("settingsMenu");
  const trigger = $("settingsTriggerBtn");
  if (!menu || !trigger) return;
  menu.classList.add("open");
  trigger.setAttribute("aria-expanded", "true");
}

function bindSettingsMenu() {
  const trigger = $("settingsTriggerBtn");
  const wrap = $("settingsMenuWrap");
  const menu = $("settingsMenu");
  const darkmodeBtn = $("menuDarkmodeBtn");
  const openPasswordBtn = $("openChangePasswordBtn");
  if (!trigger || !wrap || !menu) return;

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.classList.contains("open")) closeSettingsMenu();
    else openSettingsMenu();
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) closeSettingsMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettingsMenu();
      showPasswordModal(false);
    }
  });

  if (darkmodeBtn) {
    darkmodeBtn.addEventListener("click", () => {
      const themeToggleBtn = $("themeToggleBtn");
      if (themeToggleBtn) themeToggleBtn.click();
      closeSettingsMenu();
    });
  }

  if (openPasswordBtn) {
    openPasswordBtn.addEventListener("click", () => {
      closeSettingsMenu();
      setMsg("passwordModalMsg", "", true);
      $("currentPassword").value = "";
      $("newPassword").value = "";
      $("confirmPassword").value = "";
      showPasswordModal(true);
    });
  }
}

function bindPasswordModal() {
  const back = $("passwordModalBack");
  const closeBtn = $("closePasswordModalBtn");
  const cancelBtn = $("cancelPasswordBtn");
  const saveBtn = $("savePasswordBtn");
  if (!back || !closeBtn || !cancelBtn || !saveBtn) return;

  const close = () => showPasswordModal(false);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  back.addEventListener("click", (event) => {
    if (event.target === back) close();
  });

  saveBtn.addEventListener("click", async () => {
    const current_password = String($("currentPassword").value || "").trim();
    const new_password = String($("newPassword").value || "").trim();
    const confirm_password = String($("confirmPassword").value || "").trim();

    if (!current_password || !new_password || !confirm_password) {
      setMsg("passwordModalMsg", "Bitte alle Felder ausfüllen.");
      return;
    }
    if (new_password.length < 8) {
      setMsg("passwordModalMsg", "Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (new_password !== confirm_password) {
      setMsg("passwordModalMsg", "Die neuen Passwörter stimmen nicht überein.");
      return;
    }

    saveBtn.disabled = true;
    setMsg("passwordModalMsg", "Passwort wird gespeichert ...", true);
    try {
      const r = await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg("passwordModalMsg", data?.error || "Passwort konnte nicht geändert werden.");
        return;
      }
      setMsg("passwordModalMsg", "Passwort erfolgreich geändert.", true);
      setTimeout(() => showPasswordModal(false), 700);
    } catch {
      setMsg("passwordModalMsg", "Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function bindContainerPlanningLink() {
  const link = $("containerPlanningLink");
  if (!link) return;

  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.dataset.loading === "1") return;

    link.dataset.loading = "1";
    const originalText = link.textContent;
    link.textContent = "Container Planung wird geöffnet ...";

    try {
      const r = await api("/api/sso/container-session", { method: "GET", headers: {} });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg("moduleMsg", data?.error || "Container Planung ist aktuell nicht verfügbar.");
        return;
      }

      const targetUrl = new URL("https://containerplanung.paletten-ms.de/");
      const ssoSession = String(data?.session || "").trim();
      if (ssoSession) {
        targetUrl.searchParams.set("session", ssoSession);
      } else if (data?.url) {
        const sourceUrl = new URL(data.url);
        const forwardedSession = String(sourceUrl.searchParams.get("session") || "").trim();
        if (forwardedSession) targetUrl.searchParams.set("session", forwardedSession);
      }

      if (!targetUrl.searchParams.get("session")) {
        setMsg("moduleMsg", "Container Planung ist aktuell nicht verfügbar.");
        return;
      }

      window.location.href = targetUrl.toString();
    } catch {
      setMsg("moduleMsg", "Container Planung ist aktuell nicht verfügbar.");
    } finally {
      link.dataset.loading = "0";
      link.textContent = originalText;
    }
  });
}

async function bindContainerAdminLink() {
  const link = document.getElementById("containerAdminLink");
  if (!link) return;
  link.style.display = "none";

  try {
    const permsResponse = await api("/api/my-permissions", { method: "GET", headers: {} });
    const perms = await permsResponse.json().catch(() => ({}));
    const allowed = !!perms?.integrations?.container_registration;
    if (!allowed) return;

    link.style.display = "";
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      if (link.dataset.loading === "1") return;

      link.dataset.loading = "1";
      const originalText = link.textContent;
      link.textContent = "Container Anmeldung wird geöffnet ...";

      try {
        const r = await api("/api/sso/container-session", { method: "GET", headers: {} });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data?.url) {
          setMsg("moduleMsg", data?.error || "Container Anmeldung ist aktuell nicht verfügbar.");
          return;
        }
        window.location.href = data.url;
      } catch {
        setMsg("moduleMsg", "Container Anmeldung ist aktuell nicht verfügbar.");
      } finally {
        link.dataset.loading = "0";
        link.textContent = originalText;
      }
    });
  } catch {
    // permissions could not be loaded, keep link hidden
  }
}

$("logoutBtn")?.addEventListener("click", () => {
  closeSettingsMenu();
  localStorage.removeItem("token");
  window.location.href = "/login.html";
});

async function loadMe() {
  const r = await api("/api/me", { method: "GET", headers: {} });
  if (!r.ok) {
    localStorage.removeItem("token");
    window.location.href = "/login.html";
    return;
  }
  const me = await r.json();
  $("me").textContent = `${me.username} • ${me.business_role_name || "-"}`;
}

(async () => {
  bindSettingsMenu();
  bindPasswordModal();
  bindContainerPlanningLink();

  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  await loadMe();
  await bindContainerAdminLink();
})();
