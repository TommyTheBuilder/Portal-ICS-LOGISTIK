(function () {
  const STORAGE_KEY = "ui_lang";
  const supported = ["de", "en"];

  const translations = {
    de: {
      langLabel: "Sprache",
      de: "Deutsch",
      en: "English"
    },
    en: {
      langLabel: "Language",
      de: "German",
      en: "English"
    }
  };

  const phraseMap = {
    "Zur App-Startseite": "Go to app home",
    "Einstellungen öffnen": "Open settings",
    "Einstellungen": "Settings",
    "Passwort ändern": "Change password",
    "Darkmode umschalten": "Toggle dark mode",
    "Logout": "Log out",
    "Zur App": "Back to app",
    "Neu laden": "Reload",
    "Schließen": "Close",
    "Abbrechen": "Cancel",
    "Speichern": "Save",
    "Löschen": "Delete",
    "Anlegen": "Create",
    "Bearbeiten": "Edit",
    "Öffnen": "Open",
    "Drucken": "Print",
    "Dashboard": "Dashboard",
    "Historie": "History",
    "Vorgänge": "Cases",
    "Export": "Export",
    "Standort": "Location",
    "Abteilung": "Department",
    "Frachtführer": "Carrier",
    "Kennzeichen": "Plate",
    "Produkt": "Product",
    "Notiz": "Note",
    "Status": "Status",
    "Aktion": "Action",
    "Ja": "Yes",
    "Nein": "No",
    "Alle": "All",
    "Bitte wählen…": "Please select…",
    "Bitte wählen...": "Please select…",
    "optional": "optional",
    "mindestens 8 Zeichen": "at least 8 characters",
    "Aktuelles Passwort": "Current password",
    "Neues Passwort": "New password",
    "Neues Passwort wiederholen": "Repeat new password",
    "Passwort bestätigen": "Confirm password",
    "Keine Vorgänge": "No cases",
    "Keine Einträge gefunden": "No entries found",
    "Fehler": "Error",
    "Unbekannter Fehler": "Unknown error",
    "In Bearbeitung": "In progress",
    "In Prüfung": "Under review",
    "Gebucht": "Booked",
    "Storniert": "Cancelled",
    "Frachtführerstammdaten": "Carrier master data",
    "Administration": "Administration",
    "Benutzer": "Users",
    "Rollen & Rechte": "Roles & permissions",
    "Stammdaten": "Master data",
    "Benutzername": "Username",
    "Passwort": "Password",
    "Anmelden": "Sign in",
    "Intranet": "Intranet"
  };

  function getLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (supported.includes(saved)) return saved;
    return "de";
  }

  function setLanguage(lang) {
    const next = supported.includes(lang) ? lang : "de";
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    applyI18n();
    window.dispatchEvent(new CustomEvent("i18n:changed", { detail: { lang: next } }));
  }

  function t(key) {
    const lang = getLanguage();
    return translations[lang]?.[key] ?? translations.de[key] ?? key;
  }

  function tt(text) {
    if (getLanguage() !== "en") return text;
    const cleaned = String(text || "");
    return phraseMap[cleaned] || cleaned;
  }

  function localizeTree(root) {
    if (getLanguage() !== "en" || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const v = node.nodeValue;
      if (!v || !v.trim()) return;
      const replaced = phraseMap[v.trim()];
      if (replaced) node.nodeValue = v.replace(v.trim(), replaced);
    });

    root.querySelectorAll("[placeholder],[title],[aria-label]").forEach((el) => {
      ["placeholder", "title", "aria-label"].forEach((attr) => {
        const val = el.getAttribute(attr);
        if (!val) return;
        const translated = phraseMap[val] || val;
        if (translated !== val) el.setAttribute(attr, translated);
      });
    });
  }


  let observer = null;

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (getLanguage() !== "en") return;
      mutations.forEach((m) => {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) localizeTree(n);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function applyI18n() {
    const lang = getLanguage();
    document.documentElement.lang = lang;
    if (lang === "en") localizeTree(document.body);
    ensureObserver();
    const s = document.getElementById("langSwitch");
    if (s) s.value = lang;
    const l = document.getElementById("langSwitchLabel");
    if (l) l.textContent = t("langLabel");
  }

  function mountLanguageSwitcher() {
    if (document.getElementById("langSwitch")) return;
    const mount = document.getElementById("topbarLanguageMount")
      || document.querySelector(".topbar-actions")
      || document.querySelector("header .right")
      || document.querySelector("header");
    if (!mount) return;

    const wrap = document.createElement("div");
    wrap.className = "lang-switcher";
    wrap.innerHTML = `<label id="langSwitchLabel" for="langSwitch">${t("langLabel")}</label>
      <select id="langSwitch" class="filter-select" style="min-width:120px;">
        <option value="de">${t("de")}</option>
        <option value="en">${t("en")}</option>
      </select>`;
    mount.appendChild(wrap);

    const select = wrap.querySelector("#langSwitch");
    select.value = getLanguage();
    select.addEventListener("change", (e) => setLanguage(e.target.value));
  }

  window.I18N = { t, tt, getLanguage, setLanguage, applyI18n, mountLanguageSwitcher, localizeTree };

  document.addEventListener("DOMContentLoaded", () => {
    mountLanguageSwitcher();
    applyI18n();
  });
})();
