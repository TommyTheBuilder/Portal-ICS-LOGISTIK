const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      ...(opts.headers || {})
    }
  });
}

function $(id) { return document.getElementById(id); }

function setMsg(elId, text, ok = false) {
  const el = $(elId);
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function showApproveConfirmModal(show) {
  const back = $("approveConfirmBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
  back.setAttribute("aria-hidden", show ? "false" : "true");
}

function askApproveConfirmation() {
  return new Promise(resolve => {
    const approveBtn = $("approveConfirmBtn");
    const cancelBtn = $("approveConfirmCancelBtn");
    const closeBtn = $("closeApproveConfirmBtn");
    const back = $("approveConfirmBack");
    if (!approveBtn || !cancelBtn || !closeBtn || !back) {
      resolve(confirm("Wirklich abschließen? Danach wird gebucht (Bestand ändert sich)."));
      return;
    }

    let isDone = false;
    const done = (ok) => {
      if (isDone) return;
      isDone = true;
      showApproveConfirmModal(false);
      approveBtn.removeEventListener("click", onApprove);
      cancelBtn.removeEventListener("click", onCancel);
      closeBtn.removeEventListener("click", onCancel);
      back.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve(ok);
    };

    const onApprove = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (event) => {
      if (event.target === back) done(false);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") done(false);
    };

    approveBtn.addEventListener("click", onApprove);
    cancelBtn.addEventListener("click", onCancel);
    closeBtn.addEventListener("click", onCancel);
    back.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);

    showApproveConfirmModal(true);
  });
}

async function readJsonSafe(res) {
  try { return await res.json(); } catch { return null; }
}

function showWrapError(wrapId, msg) {
  const wrap = $(wrapId);
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="padding:10px 12px;border:1px solid #fca5a5;background:#fee2e2;border-radius:10px;">
      <b>Fehler:</b> ${String(msg || "Unbekannter Fehler")}
    </div>
  `;
}

function bindLiveToggles() {
  const stockBtn = $("toggleStockBtn");
  const stockContent = $("stockContent");
  const casesBtn = $("toggleCasesBtn");
  const casesContent = $("casesContent");

  if (stockBtn && stockContent) {
    stockBtn.addEventListener("click", () => {
      const isHidden = stockContent.style.display === "none";
      stockContent.style.display = isHidden ? "" : "none";
      stockBtn.setAttribute("aria-expanded", String(isHidden));
      stockBtn.textContent = isHidden ? "−" : "+";
    });
  }

  if (casesBtn && casesContent) {
    casesBtn.addEventListener("click", () => {
      const isHidden = casesContent.style.display === "none";
      casesContent.style.display = isHidden ? "" : "none";
      casesBtn.setAttribute("aria-expanded", String(isHidden));
      casesBtn.textContent = isHidden ? "−" : "+";
    });
  }
}

let ME = null;
let PERMS = {};
let LOCATIONS = [];
let DEPARTMENTS = [];
let ENTREPRENEURS = [];
let CURRENT_LOCATION = null;
let CURRENT_DEPARTMENT = null;

let STOCK_MODE = localStorage.getItem("stockMode") || "location_total";
if (STOCK_MODE === "location") STOCK_MODE = "location_total";
let STOCK_PRODUCT_TYPE = localStorage.getItem("stockProductType") || "euro";

const PRODUCT_TYPE_LABELS = {
  euro: "Euro-Paletten",
  h1: "H1-Paletten",
  gitterbox: "Gitterboxen"
};

const socket = io();
function joinLocationRoom() {
  if (CURRENT_LOCATION > 0) socket.emit("joinLocation", CURRENT_LOCATION);
}

// Tabs
function bindTabs() {
  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      ["dashboard", "aviso", "cases", "history", "entrepreneur-history", "export"].forEach(t => {
        const sec = document.getElementById("tab-" + t);
        if (sec) sec.style.display = (t === tab) ? "" : "none";
      });
    });
  });
}

$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
});
$("entrepreneursMasterBtn")?.addEventListener("click", () => window.location.href = "/entrepreneurs.html");
$("adminBtn").addEventListener("click", () => window.location.href = "/admin.html");

async function loadMe() {
  const r = await api("/api/me", { method: "GET", headers: {} });
  if (!r.ok) { localStorage.removeItem("token"); window.location.href = "/login.html"; return; }
  ME = await r.json();
  $("me").textContent = `${ME.username} • ${ME.business_role_name || "-"}`;
  $("adminBtn").style.display = "none";
  socket.emit("joinUser", ME.id);
}

async function loadPerms() {
  const r = await api("/api/my-permissions", { method: "GET", headers: {} });
  PERMS = r.ok ? await r.json() : {};
  applyPermsToUI();
}

function ensureOverallOption() {
  const stockSel = $("stockMode");
  if (!stockSel) return;

  let optOverall = stockSel.querySelector('option[value="overall"]');
  if (!optOverall && PERMS?.stock?.overall) {
    // ✅ Falls die Option im HTML fehlt: dynamisch hinzufügen
    optOverall = document.createElement("option");
    optOverall.value = "overall";
    optOverall.textContent = "Komplett-Bestand (alle Standorte)";
    stockSel.appendChild(optOverall);
  }

  // Sichtbarkeit/Reset
  if (optOverall) optOverall.style.display = PERMS?.stock?.overall ? "" : "none";

  if (!PERMS?.stock?.overall && stockSel.value === "overall") {
    stockSel.value = "location_total";
    STOCK_MODE = "location_total";
    localStorage.setItem("stockMode", "location_total");
  }
}

function applyPermsToUI() {
  const canCases = !!(
    PERMS?.cases?.claim
    || PERMS?.cases?.edit
    || PERMS?.cases?.submit
    || PERMS?.cases?.approve
    || PERMS?.cases?.create
    || PERMS?.cases?.cancel
    || PERMS?.cases?.delete
  );
  const canHistory = !!PERMS?.bookings?.view;
  const canExport = !!PERMS?.bookings?.export;

  const tabBtn = (name) => document.querySelector(`.tabs button[data-tab="${name}"]`);
  const canAviso = !!(PERMS?.cases?.create || PERMS?.cases?.internal_transfer);
  if (tabBtn("aviso")) tabBtn("aviso").style.display = canAviso ? "" : "none";
  if (tabBtn("cases")) tabBtn("cases").style.display = canCases ? "" : "none";
  if (tabBtn("history")) tabBtn("history").style.display = canHistory ? "" : "none";
  if (tabBtn("entrepreneur-history")) tabBtn("entrepreneur-history").style.display = canHistory ? "" : "none";
  if (tabBtn("export")) tabBtn("export").style.display = canExport ? "" : "none";

  if ($("entrepreneursMasterBtn")) {
    $("entrepreneursMasterBtn").style.display = PERMS?.masterdata?.entrepreneurs_manage ? "" : "none";
  }
  if ($("adminBtn")) {
    $("adminBtn").style.display = PERMS?.admin?.full_access ? "" : "none";
  }

  if ($("internalTransferCard")) {
    $("internalTransferCard").style.display = PERMS?.cases?.internal_transfer ? "" : "none";
  }

  ensureOverallOption();

  if ($("csvBtn")) $("csvBtn").style.display = canExport ? "" : "none";
  if ($("xlsxBtn")) $("xlsxBtn").style.display = canExport ? "" : "none";

  const employeeLabel = $("avisoEmployeeCodeLabel");
  const employeeInput = $("avisoEmployeeCode");
  if (employeeLabel && employeeInput) {
    employeeLabel.textContent = "Lagermitarbeiter (2-stellig, optional)";
    employeeInput.removeAttribute("required");
  }

  const caseEmployeeLabel = $("caseEmployeeCodeLabel");
  const caseEmployeeInput = $("caseEmployeeCode");
  if (caseEmployeeLabel && caseEmployeeInput) {
    const requiredInStatus2 = !!PERMS?.cases?.require_employee_code;
    caseEmployeeLabel.textContent = requiredInStatus2
      ? "Lagermitarbeiter (2-stellig, Pflicht bei Status 2)"
      : "Lagermitarbeiter (2-stellig, optional)";
    if (requiredInStatus2) {
      caseEmployeeInput.setAttribute("required", "required");
    } else {
      caseEmployeeInput.removeAttribute("required");
    }
  }
}

async function loadLocations() {
  const r = await api("/api/locations", { method: "GET", headers: {} });
  LOCATIONS = r.ok ? await r.json() : [];

  const sel = $("locationSelect");
  const avisoSel = $("avisoLocation");
  const transferFromSel = $("internalTransferFrom");
  const transferToSel = $("internalTransferTo");
  sel.innerHTML = "";
  if (PERMS?.filters?.all_locations) {
    const allOpt = document.createElement("option");
    allOpt.value = "-1";
    allOpt.textContent = "Alle Standorte";
    sel.appendChild(allOpt);
  }
  if (avisoSel) avisoSel.innerHTML = `<option value="">Bitte wählen…</option>`;
  if (transferFromSel) transferFromSel.innerHTML = `<option value="">Kein Absender (nur Zugang)</option>`;
  if (transferToSel) transferToSel.innerHTML = `<option value="">Bitte wählen…</option>`;
  LOCATIONS.forEach(l => {
    const o = document.createElement("option");
    o.value = l.id;
    o.textContent = l.name;
    sel.appendChild(o);

    if (avisoSel) {
      const o2 = document.createElement("option");
      o2.value = l.id;
      o2.textContent = l.name;
      avisoSel.appendChild(o2);
    }

    if (transferFromSel) {
      const o3 = document.createElement("option");
      o3.value = l.id;
      o3.textContent = l.name;
      transferFromSel.appendChild(o3);
    }

    if (transferToSel) {
      const o4 = document.createElement("option");
      o4.value = l.id;
      o4.textContent = l.name;
      transferToSel.appendChild(o4);
    }
  });

  const locked = ME && ME.role !== "admin" && ME.location_id && !PERMS?.filters?.all_locations
    ? String(ME.location_id)
    : null;
  if (locked) sel.value = locked;
  else if (PERMS?.filters?.all_locations) sel.value = "-1";
  if (avisoSel) avisoSel.value = locked || "";
  if (transferFromSel) transferFromSel.value = locked || "";
  if (transferToSel) transferToSel.value = locked || "";

  CURRENT_LOCATION = Number(sel.value || 0);
  joinLocationRoom();
}

async function loadDepartments() {
  const r = await api("/api/departments", { method: "GET", headers: {} });
  DEPARTMENTS = r.ok ? await r.json() : [];

  const sel = $("departmentSelect");
  const avisoSel = $("avisoDept");
  const caseSel = $("caseDept");
  const entHistDept = $("entHistDept");

  sel.innerHTML = "";
  avisoSel.innerHTML = `<option value="">Bitte wählen…</option>`;
  caseSel.innerHTML = "";
  if (entHistDept) entHistDept.innerHTML = `<option value="">Alle</option>`;

  DEPARTMENTS.forEach(d => {
    const o1 = document.createElement("option");
    o1.value = d.id; o1.textContent = d.name;
    sel.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = d.id; o2.textContent = d.name;
    avisoSel.appendChild(o2);

    const o3 = document.createElement("option");
    o3.value = d.id; o3.textContent = d.name;
    caseSel.appendChild(o3);

    if (entHistDept) {
      const o4 = document.createElement("option");
      o4.value = d.id; o4.textContent = d.name;
      entHistDept.appendChild(o4);
    }
  });

  CURRENT_DEPARTMENT = Number(sel.value || 0);
}

async function loadEntrepreneurs(selectedName = "") {
  const r = await api("/api/entrepreneurs", { method: "GET", headers: {} });
  ENTREPRENEURS = r.ok ? await r.json() : [];

  const sel = $("avisoEntrepreneur");
  if (!sel) return;
  const current = selectedName || "";

  sel.innerHTML = `<option value="">Bitte wählen…</option>`;
  ENTREPRENEURS.forEach((e) => {
    const o = document.createElement("option");
    o.value = e.name;
    const addr = [e.street, [e.postal_code, e.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    o.textContent = addr ? `${e.name} • ${addr}` : e.name;
    sel.appendChild(o);
  });

  if (current) sel.value = current;

  const entHistSel = $("entHistEntrepreneur");
  if (entHistSel) {
    const currentHist = entHistSel.value;
    entHistSel.innerHTML = `<option value="">Alle</option>`;
    ENTREPRENEURS.forEach((e) => {
      const o = document.createElement("option");
      o.value = e.name;
      o.textContent = e.name;
      entHistSel.appendChild(o);
    });
    if (currentHist) entHistSel.value = currentHist;
  }
}

function statusLabel(s) {
  return ({
    0: "Storniert",
    1: "Aviso",
    2: "In Bearbeitung",
    3: "In Prüfung",
    4: "Gebucht"
  })[Number(s)] || String(s);
}

function canSeeAllCases() {
  return !!(PERMS?.cases?.claim || PERMS?.cases?.edit || PERMS?.cases?.submit || PERMS?.cases?.approve || PERMS?.cases?.cancel || PERMS?.cases?.delete);
}

// ---------- Stock ----------
function updateStockHint() {
  const hint = $("stockHint");
  if (!hint) return;
  if (STOCK_MODE === "overall") hint.textContent = "Komplett-Bestand (über alle Standorte).";
  else if (STOCK_MODE === "location_total") hint.textContent = "Standort-Bestand gesamt (unabhängig von Abteilung/Frachtführer).";
  else if (STOCK_MODE === "entrepreneur") hint.textContent = "Frachtführer-Bestand (über alle Standorte).";
  else hint.textContent = "Standort-Bestand gesamt (unabhängig von Abteilung/Frachtführer).";

  hint.textContent += ` Produkt: ${PRODUCT_TYPE_LABELS[STOCK_PRODUCT_TYPE] || STOCK_PRODUCT_TYPE}`;
}

async function loadStock() {
  if (!CURRENT_LOCATION) return;

  ensureOverallOption();
  updateStockHint();

  let url = "";
  if (STOCK_MODE === "overall") {
    url = `/api/stock?mode=overall&product_type=${encodeURIComponent(STOCK_PRODUCT_TYPE)}`;
  } else if (STOCK_MODE === "location_total") {
    url = `/api/stock?mode=location_total&product_type=${encodeURIComponent(STOCK_PRODUCT_TYPE)}`;
  } else if (STOCK_MODE === "entrepreneur") {
    url = `/api/stock?mode=entrepreneur&product_type=${encodeURIComponent(STOCK_PRODUCT_TYPE)}`;
  } else {
    url = `/api/stock?mode=location_total&product_type=${encodeURIComponent(STOCK_PRODUCT_TYPE)}`;
  }

  const r = await api(url, { method: "GET", headers: {} });
  if (!r.ok) {
    const data = await readJsonSafe(r);
    return showWrapError("stockTableWrap", data?.error || `Bestand konnte nicht geladen werden (HTTP ${r.status})`);
  }

  const rows = await r.json();

  const isEntrepreneur = STOCK_MODE === "entrepreneur";
  const isLocationTotal = STOCK_MODE === "location_total";
  const head = isEntrepreneur
    ? `<tr><th>Frachtführer</th><th>Soll</th></tr>`
    : isLocationTotal
      ? `<tr><th>Standort</th><th>IN</th><th>OUT</th><th>Saldo</th></tr>`
    : `<tr><th>Abteilung</th><th>IN</th><th>OUT</th><th>Saldo</th></tr>`;
  const body = (rows || []).map(x => {
    if (isEntrepreneur) {
      return `
        <tr>
          <td>${x.entrepreneur || "-"}</td>
          <td><b>${x.saldo}</b></td>
        </tr>
      `;
    }
    if (isLocationTotal) {
      return `
        <tr>
          <td>${x.location}</td>
          <td>${x.ins}</td>
          <td>${x.outs}</td>
          <td><b>${x.saldo}</b></td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${x.department}</td>
        <td>${x.ins}</td>
        <td>${x.outs}</td>
        <td><b>${x.saldo}</b></td>
      </tr>
    `;
  }).join("");
  const emptyColspan = isEntrepreneur ? 2 : 4;
  const html = `
    <table>
      <thead>${head}</thead>
      <tbody>
        ${body}
        ${(!rows || rows.length === 0) ? `<tr><td colspan="${emptyColspan}" style="padding:10px;color:#6b7280;">Keine Daten</td></tr>` : ""}
      </tbody>
    </table>
  `;
  $("stockTableWrap").innerHTML = html;
}

if ($("stockMode")) {
  $("stockMode").value = STOCK_MODE;
  $("stockMode").addEventListener("change", async () => {
    STOCK_MODE = $("stockMode").value;
    localStorage.setItem("stockMode", STOCK_MODE);
    await loadStock();
  });
}

if ($("stockProductType")) {
  $("stockProductType").value = STOCK_PRODUCT_TYPE;
  $("stockProductType").addEventListener("change", async () => {
    STOCK_PRODUCT_TYPE = $("stockProductType").value;
    localStorage.setItem("stockProductType", STOCK_PRODUCT_TYPE);
    await loadStock();
  });
}

// ---------- Cases ----------
let CASES = [];
let ACTIVE_CASE_ID = null;
let ACTIVE_CASE_STATUS = null;
let NOTIFICATIONS = [];

function renderNotifications() {
  const panel = $("notificationPanel");
  const badge = $("notificationBadge");
  if (!panel || !badge) return;

  const unreadCount = NOTIFICATIONS.filter((n) => !n.is_read).length;
  badge.textContent = String(unreadCount);
  badge.style.display = unreadCount > 0 ? "" : "none";

  if (NOTIFICATIONS.length === 0) {
    panel.innerHTML = '<div class="notification-item">Keine Benachrichtigungen</div>';
    return;
  }

  panel.innerHTML = NOTIFICATIONS.map((n) => `
    <div class="notification-item ${n.is_read ? "" : "unread"}" data-notification-id="${n.id}" data-case-id="${n.case_id || ""}">
      <div><b>${n.title}</b></div>
      <div>${n.message}</div>
      <div class="muted">${formatDate(n.created_at)}</div>
    </div>
  `).join("");

  document.querySelectorAll("[data-notification-id]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = Number(el.getAttribute("data-notification-id"));
      const caseId = Number(el.getAttribute("data-case-id") || 0);
      if (id) {
        await api(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PUT", body: JSON.stringify({}) });
      }
      if (caseId) {
        await loadCases();
        openCaseModal(caseId);
      }
      await loadNotifications();
    });
  });
}

async function loadNotifications() {
  const r = await api("/api/notifications", { method: "GET", headers: {} });
  if (!r.ok) return;
  const data = await r.json();
  NOTIFICATIONS = Array.isArray(data.items) ? data.items : [];
  renderNotifications();
}

function bindNotificationPanel() {
  const btn = $("notificationBtn");
  const panel = $("notificationPanel");
  if (!btn || !panel) return;

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.classList.toggle("open");
  });

  document.addEventListener("click", () => panel.classList.remove("open"));
  panel.addEventListener("click", (event) => event.stopPropagation());
}

async function loadCases() {

  if (!CURRENT_LOCATION) return;

  const f = $("caseStatusFilter").value;
  const translogicaTransferred = $("caseTranslogicaFilter").value;
  const search = ($("caseSearch").value || "").trim();
  const mine = canSeeAllCases() ? "0" : "1";

  const params = new URLSearchParams({
    location_id: String(CURRENT_LOCATION),
    ...(f ? { status: f } : {}),
    ...(translogicaTransferred !== "" ? { translogica_transferred: translogicaTransferred } : {}),
    ...(search ? { search } : {}),
    ...(mine === "1" ? { mine: "1" } : {})
  });

  const r = await api(`/api/cases?${params.toString()}`, { method: "GET", headers: {} });
  CASES = r.ok ? await r.json() : [];

  renderCasesTable();
  renderCasesDashboard();
}

function renderCasesDashboard() {
  const rows = CASES.slice(0, 10);
  const html = `
    <table>
      <thead><tr><th>ID</th><th>Status</th><th>Abteilung</th><th>Kennzeichen</th><th>Produkt</th><th>IN/OUT</th><th>Aktion</th></tr></thead>
      <tbody>
        ${rows.map(c => `
          <tr>
            <td>#${c.id}</td>
            <td>${statusLabel(c.status)}</td>
            <td>${c.department}</td>
            <td><b>${c.license_plate}</b></td>
            <td>${PRODUCT_TYPE_LABELS[c.product_type] || c.product_type || "-"}</td>
            <td>${c.qty_in}/${c.qty_out}</td>
            <td><button class="secondary" data-open-case="${c.id}">Öffnen</button></td>
          </tr>
        `).join("")}
        ${(rows.length === 0) ? `<tr><td colspan="7" style="padding:10px;color:#6b7280;">Keine Vorgänge</td></tr>` : ""}
      </tbody>
    </table>
  `;
  $("casesDashWrap").innerHTML = html;
  bindOpenCaseButtons();
}

function renderCasesTable() {
  const html = `
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Status</th><th>Abteilung</th><th>Kennzeichen</th><th>Frachtführer</th><th>Translogica</th><th>Produkt</th><th>IN/OUT</th><th>Erstellt</th><th>Aktion</th>
        </tr>
      </thead>
      <tbody>
        ${CASES.map(c => `
          <tr>
            <td>#${c.id}</td>
            <td>${statusLabel(c.status)}</td>
            <td>${c.department}</td>
            <td><b>${c.license_plate}</b></td>
            <td>${c.entrepreneur || "-"}</td>
            <td>${c.translogica_transferred ? "Ja" : "Nein"}</td>
            <td>${PRODUCT_TYPE_LABELS[c.product_type] || c.product_type || "-"}</td>
            <td>${c.qty_in}/${c.qty_out}</td>
            <td>${formatDate(c.created_at)}</td>
            <td>
              <button class="secondary" data-open-case="${c.id}">Öffnen</button>
              ${(PERMS?.bookings?.receipt && Number(c.status) === 3) ? `<button class="secondary" data-print-case="${c.id}">Vorl. Druck</button>` : ""}
              ${(PERMS?.cases?.delete) ? `<button class="danger" data-delete-case="${c.id}">Löschen</button>` : ""}
            </td>
          </tr>
        `).join("")}
        ${(CASES.length === 0) ? `<tr><td colspan="10" style="padding:10px;color:#6b7280;">Keine Vorgänge</td></tr>` : ""}
      </tbody>
    </table>
  `;
  $("casesTableWrap").innerHTML = html;
  bindOpenCaseButtons();
}

function bindOpenCaseButtons() {
  document.querySelectorAll("[data-open-case]").forEach(btn => {
    btn.onclick = () => openCaseModal(Number(btn.getAttribute("data-open-case")));
  });
  document.querySelectorAll("[data-print-case]").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-print-case");
      window.open(`/receipt.html?caseId=${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
    };
  });
  document.querySelectorAll("[data-delete-case]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-delete-case");
      if (!id) return;
      if (!confirm("Vorgang wirklich löschen?")) return;
      const rr = await api(`/api/cases/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) {
        alert(data.error || "Löschen fehlgeschlagen");
        return;
      }
      await loadCases();
    };
  });
}

function showCaseModal(show) {
  $("caseModalBack").style.display = show ? "flex" : "none";
  setMsg("caseModalMsg", "");
}

$("closeCaseModalBtn").addEventListener("click", () => showCaseModal(false));

async function caseAction(action, payload = {}) {
  if (!ACTIVE_CASE_ID) return { ok: false };
  const rr = await api(`/api/cases/${encodeURIComponent(ACTIVE_CASE_ID)}`, {
    method: "PUT",
    body: JSON.stringify({ action, ...payload })
  });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) {
    setMsg("caseModalMsg", data.error || "Aktion fehlgeschlagen");
    return { ok: false };
  }
  return { ok: true, data };
}

async function fetchCaseById(id) {
  const rr = await api(`/api/cases/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: {}
  });
  if (!rr.ok) return null;
  return rr.json().catch(() => null);
}

async function openCaseModal(id) {
  let c = CASES.find(x => Number(x.id) === Number(id));
  if (!c) c = await fetchCaseById(id);
  if (!c) return;

  ACTIVE_CASE_ID = id;
  ACTIVE_CASE_STATUS = Number(c.status);

  if (Number(c.status) === 1 && PERMS?.cases?.claim) {
    const rr = await api(`/api/cases/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ action: "claim" })
    });
    if (rr.ok) {
      const refreshed = await fetchCaseById(id);
      c = refreshed || CASES.find(x => Number(x.id) === Number(id)) || c;
      await loadCases();
    }
  }

  ACTIVE_CASE_STATUS = Number(c.status);

  $("caseModalMeta").textContent = `#${c.id} • Status ${c.status} (${statusLabel(c.status)}) • ${c.location}`;

  $("caseDept").value = String(c.department_id);
  $("casePlate").value = c.license_plate || "";
  $("caseEntrepreneur").value = c.entrepreneur || "";
  $("caseNote").value = c.note || "";
  $("caseIn").value = c.qty_in ?? 0;
  $("caseOut").value = c.qty_out ?? 0;
  const nonExchangeableQty = Number(c.non_exchangeable_qty ?? 0);
  $("caseNonExchangeable").value = nonExchangeableQty;
  $("caseProductType").value = c.product_type || "euro";
  $("caseTranslogicaTransferred").checked = !!c.translogica_transferred;
  $("caseTranslogicaTransferred").disabled = !(PERMS?.bookings?.translogica && Number(c.status) === 4);
  $("caseTranslogicaTransferred").closest("div").style.display = Number(c.status) === 4 ? "" : "none";
  const showNonExchangeable = Number(c.status) >= 2;
  const showStatus2Fields = Number(c.status) === 2;
  const showStatus4EmployeeField = Number(c.status) === 4;
  $("caseNonExchangeableWrap").style.display = showNonExchangeable ? "" : "none";
  $("caseNonExchangeable").disabled = !showStatus2Fields;
  $("caseEmployeeCodeWrap").style.display = showStatus2Fields ? "" : "none";
  $("caseEmployeeCode").disabled = !showStatus2Fields;
  $("caseEmployeeCode").value = c.employee_code || "";
  $("caseEmployeeCodeStatus4Wrap").style.display = showStatus4EmployeeField ? "" : "none";
  $("caseEmployeeCodeStatus4").value = c.employee_code || "";
  $("caseProductType").disabled = Number(c.status) === 4;

  $("saveCaseBtn").style.display = (PERMS?.cases?.edit && (c.status === 1 || c.status === 2)) ? "" : "none";
  $("claimCaseBtn").style.display = (PERMS?.cases?.claim && c.status === 1) ? "" : "none";
  $("submitCaseBtn").style.display = (PERMS?.cases?.submit && c.status === 2) ? "" : "none";
  $("printCaseBtn").style.display = (PERMS?.bookings?.receipt && [3, 4].includes(Number(c.status))) ? "" : "none";
  $("printCaseBtn").textContent = Number(c.status) === 4 ? "Drucken" : "Vorläufig drucken";
  $("approveCaseBtn").style.display = (PERMS?.cases?.approve && c.status === 3) ? "" : "none";
  $("cancelCaseBtn").style.display = (PERMS?.cases?.cancel && [1, 2, 3].includes(Number(c.status))) ? "" : "none";
  $("deleteCaseBtn").style.display = (PERMS?.cases?.delete && [0, 1].includes(Number(c.status))) ? "" : "none";

  showCaseModal(true);
}

$("saveCaseBtn").addEventListener("click", async () => {
  setMsg("caseModalMsg", "");
  const { ok } = await caseAction("edit", {
    department_id: $("caseDept").value,
    license_plate: $("casePlate").value,
    entrepreneur: $("caseEntrepreneur").value,
    note: $("caseNote").value,
    qty_in: Number($("caseIn").value || 0),
    qty_out: Number($("caseOut").value || 0),
    non_exchangeable_qty: ACTIVE_CASE_STATUS === 2 ? Number($("caseNonExchangeable").value || 0) : undefined,
    employee_code: ACTIVE_CASE_STATUS === 2 ? (($("caseEmployeeCode").value || "").trim().toUpperCase() || null) : undefined,
    product_type: $("caseProductType").value
  });
  if (!ok) return;
  setMsg("caseModalMsg", "Gespeichert", true);
  await loadCases();
});

$("approveCaseBtn").addEventListener("click", async () => {
  setMsg("caseModalMsg", "");
  const isConfirmed = await askApproveConfirmation();
  if (!isConfirmed) return;

  const { ok, data } = await caseAction("approve");
  if (!ok) return;

  setMsg("caseModalMsg", `Abgeschlossen. Belegnummer: ${data.receipt_no}`, true);
  await loadCases();
  await loadStock();
  await loadHistory();
});

$("caseTranslogicaTransferred").addEventListener("change", async () => {
  const { ok } = await caseAction("set_translogica", {
    translogica_transferred: $("caseTranslogicaTransferred").checked
  });
  if (!ok) return;
  setMsg("caseModalMsg", "Translogica-Status gespeichert", true);
  await loadCases();
});

$("claimCaseBtn").addEventListener("click", async () => {
  const { ok } = await caseAction("claim");
  if (ok) { await loadCases(); }
});

$("submitCaseBtn").addEventListener("click", async () => {
  const employee_code = (($("caseEmployeeCode").value || "").trim().toUpperCase() || "");
  if (ACTIVE_CASE_STATUS === 2 && PERMS?.cases?.require_employee_code && !employee_code) {
    return setMsg("caseModalMsg", "Lagermitarbeiter (2-stellig) ist bei Status 2 Pflicht");
  }
  if (employee_code && !/^[A-Z0-9]{2}$/.test(employee_code)) {
    return setMsg("caseModalMsg", "Lagermitarbeiter muss genau 2 Zeichen haben");
  }

  const payload = ACTIVE_CASE_STATUS === 2
    ? {
      non_exchangeable_qty: Number($("caseNonExchangeable").value || 0),
      employee_code: employee_code || null
    }
    : {};
  const { ok } = await caseAction("submit", payload);
  if (ok) { await loadCases(); }
});

$("printCaseBtn").addEventListener("click", () => {
  if (!ACTIVE_CASE_ID) return;
  window.open(`/receipt.html?caseId=${encodeURIComponent(ACTIVE_CASE_ID)}`, "_blank", "noopener,noreferrer");
});

$("cancelCaseBtn").addEventListener("click", async () => {
  setMsg("caseModalMsg", "");
  if (!ACTIVE_CASE_ID) return;
  if (!confirm("Vorgang wirklich stornieren?")) return;

  const { ok } = await caseAction("cancel");
  if (!ok) return;
  setMsg("caseModalMsg", "Vorgang storniert", true);
  await loadCases();
});

$("deleteCaseBtn").addEventListener("click", async () => {
  setMsg("caseModalMsg", "");
  if (!ACTIVE_CASE_ID) return;
  if (!confirm("Vorgang wirklich löschen?")) return;

  const rr = await api(`/api/cases/${encodeURIComponent(ACTIVE_CASE_ID)}`, { method: "DELETE" });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) {
    setMsg("caseModalMsg", data.error || "Löschen fehlgeschlagen");
    return;
  }
  setMsg("caseModalMsg", "Vorgang gelöscht", true);
  showCaseModal(false);
  await loadCases();
});

// ---------- Aviso ----------
function resetAvisoForm() {
  $("avisoLocation").value = "";
  $("avisoDept").value = "";
  $("avisoPlate").value = "";
  $("avisoEntrepreneur").value = "";
  $("avisoEntrepreneurFree").value = "";
  $("avisoNote").value = "";
  $("avisoIn").value = 0;
  $("avisoOut").value = 0;
  $("avisoProductType").value = "euro";
  $("avisoEmployeeCode").value = "";
}

function resetInternalTransferForm() {
  if ($("internalTransferFrom")) $("internalTransferFrom").value = "";
  if ($("internalTransferTo")) $("internalTransferTo").value = "";
  if ($("internalTransferProductType")) $("internalTransferProductType").value = "euro";
  if ($("internalTransferQty")) $("internalTransferQty").value = 1;
  if ($("internalTransferNote")) $("internalTransferNote").value = "";
}

$("createAvisoBtn").addEventListener("click", async () => {
  setMsg("avisoMsg", "");
  if (!PERMS?.cases?.create) return setMsg("avisoMsg", "Keine Berechtigung für Aviso");

  const department_id = $("avisoDept").value;
  const location_id = $("avisoLocation").value;
  const license_plate = ($("avisoPlate").value || "").trim();
  const entrepreneurFree = ($("avisoEntrepreneurFree").value || "").trim();
  const entrepreneurSelect = $("avisoEntrepreneur").value;
  const entrepreneur = entrepreneurFree || entrepreneurSelect;
  const note = $("avisoNote").value;
  const qty_in = Number($("avisoIn").value || 0);
  const qty_out = Number($("avisoOut").value || 0);
  const product_type = $("avisoProductType").value;
  const employee_code_raw = ($("avisoEmployeeCode").value || "").trim();
  const employee_code = employee_code_raw ? employee_code_raw.toUpperCase() : "";

  if (!location_id) return setMsg("avisoMsg", "Bitte Lager auswählen");
  if (!department_id) return setMsg("avisoMsg", "Bitte Abteilung auswählen");
  if (!license_plate) return setMsg("avisoMsg", "Kennzeichen ist Pflicht");
  if (employee_code && !/^[A-Z0-9]{2}$/.test(employee_code)) {
    return setMsg("avisoMsg", "Lagermitarbeiter muss genau 2 Zeichen haben");
  }

  const rr = await api("/api/cases", {
    method: "POST",
    body: JSON.stringify({
      location_id: Number(location_id),
      department_id: Number(department_id),
      license_plate,
      entrepreneur,
      note,
      qty_in,
      qty_out,
      product_type,
      employee_code: employee_code || null
    })
  });

  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("avisoMsg", data.error || "Aviso konnte nicht erstellt werden");

  setMsg("avisoMsg", `Aviso erstellt (#${data.id})`, true);
  resetAvisoForm();

  await loadCases();
});

$("createInternalTransferBtn")?.addEventListener("click", async () => {
  setMsg("internalTransferMsg", "");
  if (!PERMS?.cases?.internal_transfer) return setMsg("internalTransferMsg", "Keine Berechtigung für interne Lagerumbuchung");

  const from_location_id = Number($("internalTransferFrom")?.value || 0) || null;
  const to_location_id = Number($("internalTransferTo")?.value || 0);
  const qty = Number($("internalTransferQty")?.value || 0);
  const note = String($("internalTransferNote")?.value || "").trim();
  const product_type = $("internalTransferProductType")?.value || "euro";

  if (!to_location_id) return setMsg("internalTransferMsg", "Empfänger Standort/Lager ist Pflicht");
  if (!Number.isInteger(qty) || qty <= 0) return setMsg("internalTransferMsg", "Menge muss größer als 0 sein");
  if (!note) return setMsg("internalTransferMsg", "Notiz ist Pflicht");
  if (from_location_id && from_location_id === to_location_id) {
    return setMsg("internalTransferMsg", "Absender und Empfänger dürfen nicht identisch sein");
  }

  const rr = await api("/api/internal-transfers", {
    method: "POST",
    body: JSON.stringify({
      from_location_id,
      to_location_id,
      qty,
      note,
      product_type
    })
  });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("internalTransferMsg", data.error || "Umbuchung konnte nicht gebucht werden");

  setMsg("internalTransferMsg", `Umbuchung gebucht (${data.mode === "transfer" ? "OUT/IN" : "IN"})`, true);
  resetInternalTransferForm();
  await loadStock();
  await loadHistory({ resetPage: true });
});

function toggleEntrepreneurModal(show) {
  const back = $("entrepreneurModalBack");
  if (!back) return;
  back.style.display = show ? "flex" : "none";
}

function setEntrepreneurModalMsg(text, ok = false) {
  const el = $("entrepreneurModalMsg");
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

function clearEntrepreneurModal() {
  ["modalEntrepreneurName", "modalEntrepreneurStreet", "modalEntrepreneurPostal", "modalEntrepreneurCity"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  setEntrepreneurModalMsg("");
}

$("addEntrepreneurBtn").addEventListener("click", () => {
  setMsg("avisoMsg", "");
  if (!PERMS?.cases?.create) return setMsg("avisoMsg", "Keine Berechtigung für Aviso");
  clearEntrepreneurModal();
  toggleEntrepreneurModal(true);
  $("modalEntrepreneurName")?.focus();
});

$("closeEntrepreneurModalBtn")?.addEventListener("click", () => toggleEntrepreneurModal(false));
$("cancelEntrepreneurModalBtn")?.addEventListener("click", () => toggleEntrepreneurModal(false));
$("entrepreneurModalBack")?.addEventListener("click", (e) => {
  if (e.target?.id === "entrepreneurModalBack") toggleEntrepreneurModal(false);
});

$("saveEntrepreneurModalBtn")?.addEventListener("click", async () => {
  setEntrepreneurModalMsg("");
  const name = ($("modalEntrepreneurName")?.value || "").trim();
  const street = ($("modalEntrepreneurStreet")?.value || "").trim();
  const postal_code = ($("modalEntrepreneurPostal")?.value || "").trim();
  const city = ($("modalEntrepreneurCity")?.value || "").trim();

  if (!name) return setEntrepreneurModalMsg("Bitte einen Frachtführer-Namen eingeben");

  const r = await api("/api/entrepreneurs", {
    method: "POST",
    body: JSON.stringify({
      name,
      street: street || null,
      postal_code: postal_code || null,
      city: city || null
    })
  });
  const data = await readJsonSafe(r);
  if (!r.ok) return setEntrepreneurModalMsg(data?.error || "Frachtführer konnte nicht gespeichert werden");

  await loadEntrepreneurs(data?.name || name);
  $("avisoEntrepreneur").value = data?.name || name;
  setMsg("avisoMsg", "Frachtführer gespeichert", true);
  toggleEntrepreneurModal(false);
});

// ---------- Historie ----------
let HISTORY = [];
let ENTREPRENEUR_HISTORY = [];
const HISTORY_PAGE_SIZE = 20;
let HISTORY_PAGE = 0;
let HISTORY_HAS_MORE = false;

async function loadHistory({ resetPage = false } = {}) {
  if (!CURRENT_LOCATION) return;
  if (resetPage) HISTORY_PAGE = 0;

  // ✅ falls CURRENT_DEPARTMENT nicht gesetzt ist: aus Select holen
  if (!CURRENT_DEPARTMENT) {
    CURRENT_DEPARTMENT = Number($("departmentSelect")?.value || 0);
  }
  if (!CURRENT_DEPARTMENT) {
    return showWrapError("historyWrap", "Bitte eine Abteilung auswählen (für Historie/Export).");
  }

  const from = $("histFrom")?.value || "";
  const to = $("histTo")?.value || "";
  const entrepreneur = ($("histEntrepreneur")?.value || "").trim();
  const license_plate = ($("histPlate")?.value || "").trim();
  const receipt_no = ($("histReceipt")?.value || "").trim();

  const qs = new URLSearchParams({
    location_id: String(CURRENT_LOCATION),
    department_id: String(CURRENT_DEPARTMENT),
    limit: String(HISTORY_PAGE_SIZE),
    offset: String(HISTORY_PAGE * HISTORY_PAGE_SIZE),
    ...(from ? { date_from: from } : {}),
    ...(to ? { date_to: to } : {}),
    ...(entrepreneur ? { entrepreneur } : {}),
    ...(license_plate ? { license_plate } : {}),
    ...(receipt_no ? { receipt_no } : {})
  }).toString();

  const r = await api(`/api/bookings?${qs}`, { method: "GET", headers: {} });
  if (!r.ok) {
    const data = await readJsonSafe(r);
    return showWrapError("historyWrap", data?.error || `Historie konnte nicht geladen werden (HTTP ${r.status})`);
  }

  const data = await r.json();
  HISTORY = Array.isArray(data?.items) ? data.items : [];
  HISTORY_HAS_MORE = Boolean(data?.has_more);
  renderHistory();
}

async function loadEntrepreneurHistory() {
  if (!CURRENT_LOCATION) return;

  const entrepreneur = ($("entHistEntrepreneur")?.value || "").trim();
  const license_plate = ($("entHistPlate")?.value || "").trim();
  const department_id = $("entHistDept")?.value || "";

  const qs = new URLSearchParams({
    location_id: String(CURRENT_LOCATION),
    ...(department_id ? { department_id: String(department_id) } : {}),
    ...(entrepreneur ? { entrepreneur } : {}),
    ...(license_plate ? { license_plate } : {})
  }).toString();

  const r = await api(`/api/entrepreneur-history?${qs}`, { method: "GET", headers: {} });
  if (!r.ok) {
    const data = await readJsonSafe(r);
    return showWrapError("entrepreneurHistoryWrap", data?.error || `Frachtführer-Historie konnte nicht geladen werden (HTTP ${r.status})`);
  }

  ENTREPRENEUR_HISTORY = await r.json();
  renderEntrepreneurHistory();
}

async function loadEntrepreneurHistoryPlates() {
  if (!CURRENT_LOCATION) return;
  const department_id = $("entHistDept")?.value || "";
  const qs = new URLSearchParams({
    location_id: String(CURRENT_LOCATION),
    ...(department_id ? { department_id: String(department_id) } : {})
  }).toString();

  const r = await api(`/api/entrepreneur-history/plates?${qs}`, { method: "GET", headers: {} });
  if (!r.ok) return;
  const plates = await r.json();

  const plateSel = $("entHistPlate");
  if (!plateSel) return;
  const current = plateSel.value;
  plateSel.innerHTML = `<option value="">Alle</option>`;
  (plates || []).forEach((p) => {
    const o = document.createElement("option");
    o.value = p.license_plate;
    o.textContent = p.license_plate;
    plateSel.appendChild(o);
  });
  if (current) plateSel.value = current;
}

function renderHistory() {
  const html = `
    <div class="rollcard-list">
      ${HISTORY.map(h => `
        <div class="rollcard">
          <div class="rollcard-grid">
            <div class="rollcard-item">
              <label>Datum</label>
              <div>${formatDate(h.created_at)}</div>
            </div>
            <div class="rollcard-item">
              <label>Beleg</label>
              <div>${h.receipt_no || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Kennzeichen</label>
              <div>${h.license_plate || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Frachtführer</label>
              <div>${h.entrepreneur || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>IN</label>
              <div>${h.qty_in}</div>
            </div>
            <div class="rollcard-item">
              <label>OUT</label>
              <div>${h.qty_out}</div>
            </div>
            <div class="rollcard-item">
              <label>Produkt</label>
              <div>${PRODUCT_TYPE_LABELS[h.product_type] || h.product_type || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Aviso erstellt</label>
              <div>${h.aviso_created_by || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Lagermitarbeiter</label>
              <div>${h.employee_code || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Abgeschlossen</label>
              <div>${h.aviso_approved_by || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Aktion</label>
              <div>
                ${(PERMS?.bookings?.receipt && h.receipt_no) ? `<button class="secondary" data-print="${h.id}">Druck</button>` : "-"}
              </div>
            </div>
          </div>
        </div>
      `).join("")}
      ${(HISTORY.length === 0) ? `<div class="rollcard" style="color:#6b7280;">Keine Buchungen gefunden</div>` : ""}
    </div>
    <div class="row" style="margin-top:10px; align-items:center; gap:10px;">
      <button class="secondary" id="historyPrevBtn" ${HISTORY_PAGE === 0 ? "disabled" : ""}>Zurück</button>
      <button class="secondary" id="historyNextBtn" ${!HISTORY_HAS_MORE ? "disabled" : ""}>Weiter</button>
      <span class="muted">Seite ${HISTORY_PAGE + 1} · max. ${HISTORY_PAGE_SIZE} Buchungen pro Seite</span>
    </div>
  `;
  $("historyWrap").innerHTML = html;

  document.querySelectorAll("[data-print]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-print");
      window.open(`/receipt.html?id=${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
    });
  });

  $("historyPrevBtn")?.addEventListener("click", async () => {
    if (HISTORY_PAGE === 0) return;
    HISTORY_PAGE -= 1;
    await loadHistory();
  });

  $("historyNextBtn")?.addEventListener("click", async () => {
    if (!HISTORY_HAS_MORE) return;
    HISTORY_PAGE += 1;
    await loadHistory();
  });
}

function renderEntrepreneurHistory() {
  const totalSoll = (ENTREPRENEUR_HISTORY || []).reduce((sum, h) => sum + Number(h.soll || 0), 0);
  const totalEl = $("entHistTotal");
  if (totalEl) {
    totalEl.textContent = `Gesamt-Soll (nach Filter): ${totalSoll}`;
  }
  const html = `
    <div class="rollcard-list">
      ${ENTREPRENEUR_HISTORY.map(h => `
        <div class="rollcard">
          <div class="rollcard-grid">
            <div class="rollcard-item">
              <label>Letzte Aktivität</label>
              <div>${formatDate(h.last_seen || h.created_at)}</div>
            </div>
            <div class="rollcard-item">
              <label>Frachtführer</label>
              <div>${h.entrepreneur || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Abteilung</label>
              <div>${h.department || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Kennzeichen</label>
              <div>${h.license_plate || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Produkt</label>
              <div>${PRODUCT_TYPE_LABELS[h.product_type] || h.product_type || "-"}</div>
            </div>
            <div class="rollcard-item">
              <label>Soll</label>
              <div>${Number(h.soll ?? 0)}</div>
            </div>
          </div>
        </div>
      `).join("")}
      ${(ENTREPRENEUR_HISTORY.length === 0) ? `<div class="rollcard" style="color:#6b7280;">Keine Einträge gefunden</div>` : ""}
    </div>
  `;
  $("entrepreneurHistoryWrap").innerHTML = html;
}

// ---------- Export ----------
async function downloadWithAuth(url, fallbackFilename) {
  try {
    const r = await api(url, { method: "GET", headers: {} });
    if (!r.ok) {
      const data = await r.json().catch(() => null);
      alert(data?.error || `Export fehlgeschlagen (HTTP ${r.status})`);
      return;
    }

    const blob = await r.blob();

    // Dateiname aus Content-Disposition holen (server.js setzt das bereits)
    const cd = r.headers.get("Content-Disposition") || "";
    let filename = fallbackFilename;
    const m = cd.match(/filename="([^"]+)"/i);
    if (m && m[1]) filename = m[1];

    const a = document.createElement("a");
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch (e) {
    alert("Export fehlgeschlagen: " + (e?.message || e));
  }
}

$("csvBtn").addEventListener("click", async () => {
  if (!CURRENT_LOCATION || !CURRENT_DEPARTMENT) return;

  const url = `/api/export/csv?location_id=${encodeURIComponent(CURRENT_LOCATION)}&department_id=${encodeURIComponent(CURRENT_DEPARTMENT)}`;
  await downloadWithAuth(url, "buchungen.csv");
});

$("xlsxBtn").addEventListener("click", async () => {
  if (!CURRENT_LOCATION || !CURRENT_DEPARTMENT) return;

  const url = `/api/export/xlsx?location_id=${encodeURIComponent(CURRENT_LOCATION)}&department_id=${encodeURIComponent(CURRENT_DEPARTMENT)}`;
  await downloadWithAuth(url, "buchungen.xlsx");
});


// ---------- Events ----------
$("locationSelect").addEventListener("change", async () => {
  CURRENT_LOCATION = Number($("locationSelect").value || 0);
  joinLocationRoom();
  await loadCases();
  await loadHistory({ resetPage: true });
  await loadEntrepreneurHistoryPlates();
  await loadEntrepreneurHistory();
});

$("departmentSelect").addEventListener("change", async () => {
  CURRENT_DEPARTMENT = Number($("departmentSelect").value || 0);
  await loadHistory({ resetPage: true });
});

$("reloadCasesBtn").addEventListener("click", loadCases);
$("caseStatusFilter").addEventListener("change", loadCases);
$("caseTranslogicaFilter").addEventListener("change", loadCases);
$("caseSearch").addEventListener("input", () => {
  clearTimeout(window.__caseSearchT);
  window.__caseSearchT = setTimeout(loadCases, 250);
});
$("reloadHistoryBtn").addEventListener("click", () => loadHistory({ resetPage: true }));
if ($("histEntrepreneur")) {
  $("histEntrepreneur").addEventListener("input", () => {
    clearTimeout(window.__histEntrepreneurT);
    window.__histEntrepreneurT = setTimeout(() => loadHistory({ resetPage: true }), 250);
  });
}
if ($("histPlate")) {
  $("histPlate").addEventListener("input", () => {
    clearTimeout(window.__histPlateT);
    window.__histPlateT = setTimeout(() => loadHistory({ resetPage: true }), 250);
  });
}
if ($("histReceipt")) {
  $("histReceipt").addEventListener("input", () => {
    clearTimeout(window.__histReceiptT);
    window.__histReceiptT = setTimeout(() => loadHistory({ resetPage: true }), 250);
  });
}
$("entHistReloadBtn").addEventListener("click", loadEntrepreneurHistory);
if ($("entHistEntrepreneur")) {
  $("entHistEntrepreneur").addEventListener("change", loadEntrepreneurHistory);
}
if ($("entHistPlate")) {
  $("entHistPlate").addEventListener("change", loadEntrepreneurHistory);
}
if ($("entHistDept")) {
  $("entHistDept").addEventListener("change", async () => {
    await loadEntrepreneurHistoryPlates();
    await loadEntrepreneurHistory();
  });
}

// Live events
socket.on("stockUpdated", async (payload) => {
  if (payload?.location_id && Number(payload.location_id) === Number(CURRENT_LOCATION)) return loadStock();
  if (payload?.from_location_id && Number(payload.from_location_id) === Number(CURRENT_LOCATION)) return loadStock();
  if (payload?.to_location_id && Number(payload.to_location_id) === Number(CURRENT_LOCATION)) return loadStock();
  if (!payload?.location_id && !payload?.from_location_id && !payload?.to_location_id) return loadStock();
});
socket.on("casesUpdated", async (payload) => {
  if (payload?.location_id && Number(payload.location_id) === Number(CURRENT_LOCATION)) {
    await loadCases();
  }
});
socket.on("notificationCreated", async () => {
  await loadNotifications();
});

socket.on("notificationsDeleted", async (payload) => {
  const ids = Array.isArray(payload?.notification_ids)
    ? payload.notification_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  if (ids.length > 0) {
    const idSet = new Set(ids);
    NOTIFICATIONS = NOTIFICATIONS.filter((item) => !idSet.has(Number(item.id)));
    renderNotifications();
    return;
  }

  await loadNotifications();
});

socket.on("bookingsUpdated", async (payload) => {
  if (!payload?.location_id) return;
  if (Number(payload.location_id) !== Number(CURRENT_LOCATION)) return;
  // Wenn Department gefiltert ist, nur dann auto-reload, wenn es passt
  if (payload.department_id && CURRENT_DEPARTMENT && Number(payload.department_id) !== Number(CURRENT_DEPARTMENT)) return;
  await loadHistory({ resetPage: true });
  await loadStock();
});

// Init
(async function init() {
  bindTabs();
  bindLiveToggles();
  bindNotificationPanel();
  await loadMe();
  await loadPerms();
  await loadLocations();
  await loadDepartments();
  await loadEntrepreneurs();

  CURRENT_DEPARTMENT = Number($("departmentSelect")?.value || 0);

  if ($("stockMode")) {
    $("stockMode").value = STOCK_MODE;
    ensureOverallOption();
    updateStockHint();
  }

  await loadStock();
  await loadCases();
  await loadNotifications();
  await loadHistory({ resetPage: true });
  await loadEntrepreneurHistoryPlates();
  await loadEntrepreneurHistory();
})();
