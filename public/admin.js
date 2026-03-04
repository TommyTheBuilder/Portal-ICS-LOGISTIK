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
function setMsg(id, text, ok = false) {
  const el = $(id);
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

let LOCATIONS = [];
let DEPARTMENTS = [];
let ENTREPRENEURS = [];
let ROLES = [];
let USERS = [];
let EDIT_ENTREPRENEUR_ID = null;
let IS_ADMIN = false;
let PERMS = {};

// ---------------- Tabs ----------------
function bindTabs() {
  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      ["roles","master","users"].forEach(t => {
        const sec = document.getElementById("tab-" + t);
        if (sec) sec.style.display = (t === tab) ? "" : "none";
      });
    });
  });
}

// ---------------- Auth UI ----------------
$("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
});
$("backBtn")?.addEventListener("click", () => window.location.href = "/app.html");

// ---------------- Loaders ----------------
async function loadMe() {
  const r = await api("/api/me", { method: "GET", headers: {} });
  if (!r.ok) { localStorage.removeItem("token"); window.location.href = "/login.html"; return; }
  const me = await r.json();
  $("me").textContent = `${me.username} • ${me.role}`;
  IS_ADMIN = me.role === "admin";
}

async function loadPerms() {
  const r = await api("/api/my-permissions", { method: "GET", headers: {} });
  PERMS = r.ok ? await r.json() : {};
}

async function loadLocations() {
  const r = await api("/api/locations", { method: "GET", headers: {} });
  LOCATIONS = r.ok ? await r.json() : [];

  // table
  const body = $("locBody");
  if (body) {
    body.innerHTML = "";
    LOCATIONS.forEach(l => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${l.name}</td>
        <td><button class="danger" data-del-loc="${l.id}">Löschen</button></td>
      `;
      body.appendChild(tr);
    });
  }

  // user create select
  const sel = $("uLocation");
  if (sel) {
    sel.innerHTML = `<option value="">(kein Standort)</option>`;
    LOCATIONS.forEach(l => {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name;
      sel.appendChild(o);
    });
  }

  const editLocSel = $("editUserLocation");
  if (editLocSel) {
    editLocSel.innerHTML = `<option value="">(kein Standort)</option>`;
    LOCATIONS.forEach(l => {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name;
      editLocSel.appendChild(o);
    });
  }

  // bind delete
  document.querySelectorAll("[data-del-loc]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del-loc");
      if (!confirm("Standort wirklich löschen? (nur möglich wenn keine Buchungen vorhanden sind)")) return;

      const rr = await api(`/api/admin/locations/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) return setMsg("locMsg", data.error || "Löschen nicht möglich");
      setMsg("locMsg", "Standort gelöscht", true);
      await loadLocations();
    });
  });
}

function applyRoleLocationHint() {
  const roleSel = $("uRole");
  const locSel = $("uLocation");
  const hint = $("roleLocationHint");
  if (!roleSel || !locSel || !hint) return;
  const isLager = roleSel.value === "lager";
  if (isLager) {
    locSel.setAttribute("required", "required");
    hint.style.display = "";
  } else {
    locSel.removeAttribute("required");
    hint.style.display = "none";
  }
}

function applyEditRoleLocationHint() {
  const roleSel = $("editUserRole");
  const locSel = $("editUserLocation");
  const hint = $("editRoleLocationHint");
  if (!roleSel || !locSel || !hint) return;
  const isLager = roleSel.value === "lager";
  if (isLager) {
    locSel.setAttribute("required", "required");
    hint.style.display = "";
  } else {
    locSel.removeAttribute("required");
    hint.style.display = "none";
  }
}

async function loadDepartments() {
  const r = await api("/api/departments", { method: "GET", headers: {} });
  DEPARTMENTS = r.ok ? await r.json() : [];

  const body = $("depBody");
  if (!body) return;
  body.innerHTML = "";
  DEPARTMENTS.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.name}</td>
      <td><button class="danger" data-del-dep="${d.id}">Löschen</button></td>
    `;
    body.appendChild(tr);
  });

  document.querySelectorAll("[data-del-dep]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del-dep");
      if (!confirm("Abteilung wirklich löschen? (nur möglich wenn keine Buchungen vorhanden sind)")) return;

      const rr = await api(`/api/admin/departments/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) return setMsg("depMsg", data.error || "Löschen nicht möglich");
      setMsg("depMsg", "Abteilung gelöscht", true);
      await loadDepartments();
    });
  });

  const fixedSelect = $("uFixedDepartment");
  if (fixedSelect) {
    fixedSelect.innerHTML = `<option value="">(keine)</option>`;
    DEPARTMENTS.forEach(d => {
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = d.name;
      fixedSelect.appendChild(o);
    });
  }

  const editSelect = $("editUserDepartment");
  if (editSelect) {
    editSelect.innerHTML = `<option value="">(keine)</option>`;
    DEPARTMENTS.forEach(d => {
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = d.name;
      editSelect.appendChild(o);
    });
  }
}

async function loadEntrepreneurs() {
  const r = await api("/api/admin/entrepreneurs", { method: "GET", headers: {} });
  ENTREPRENEURS = r.ok ? await r.json() : [];

  const body = $("entBody");
  if (!body) return;
  body.innerHTML = "";
  ENTREPRENEURS.forEach(e => {
    const tr = document.createElement("tr");
    const address = [
      e.street,
      [e.postal_code, e.city].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");
    tr.innerHTML = `
      <td><b>${e.name}</b></td>
      <td>${address || "-"}</td>
      <td>
        <button class="secondary" data-ent-edit="${e.id}">Bearbeiten</button>
        <button class="danger" data-ent-del="${e.id}">Löschen</button>
      </td>
    `;
    body.appendChild(tr);
  });

  document.querySelectorAll("[data-ent-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-ent-edit");
      const ent = ENTREPRENEURS.find(e => String(e.id) === String(id));
      if (!ent) return;
      EDIT_ENTREPRENEUR_ID = ent.id;
      $("entName").value = ent.name || "";
      $("entStreet").value = ent.street || "";
      $("entPostal").value = ent.postal_code || "";
      $("entCity").value = ent.city || "";
      setMsg("entMsg", "Bearbeitungsmodus aktiv", true);
    });
  });

  document.querySelectorAll("[data-ent-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ent-del");
      if (!confirm("Unternehmer wirklich löschen?")) return;
      const rr = await api(`/api/admin/entrepreneurs/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) return setMsg("entMsg", data.error || "Löschen fehlgeschlagen");
      setMsg("entMsg", "Unternehmer gelöscht", true);
      if (String(EDIT_ENTREPRENEUR_ID) === String(id)) {
        EDIT_ENTREPRENEUR_ID = null;
        $("entName").value = "";
        $("entStreet").value = "";
        $("entPostal").value = "";
        $("entCity").value = "";
      }
      await loadEntrepreneurs();
    });
  });
}

async function loadRoles() {
  const r = await api("/api/admin/roles", { method: "GET", headers: {} });
  ROLES = r.ok ? await r.json() : [];

  // Role select (edit)
  const sel = $("roleSelect");
  if (sel) {
    sel.innerHTML = "";
    ROLES.forEach(role => {
      const o = document.createElement("option");
      o.value = role.id;
      o.textContent = role.name;
      sel.appendChild(o);
    });
  }

  // Role select (user create)
  const userRoleSel = $("uRoleId");
  if (userRoleSel) {
    userRoleSel.innerHTML = `<option value="">(keine)</option>`;
    ROLES.forEach(role => {
      const o = document.createElement("option");
      o.value = role.id;
      o.textContent = role.name;
      userRoleSel.appendChild(o);
    });
  }

  // apply permissions for currently selected
  if (sel && sel.value) applyRoleToCheckboxes(Number(sel.value));
}

async function loadUsers() {
  const r = await api("/api/admin/users", { method: "GET", headers: {} });
  USERS = r.ok ? await r.json() : [];

  const body = $("usersBody");
  if (!body) return;
  body.innerHTML = "";

  const locName = (id) => LOCATIONS.find(x => String(x.id) === String(id))?.name || "-";
  const roleName = (id) => ROLES.find(x => String(x.id) === String(id))?.name || "-";
  const depName = (id) => DEPARTMENTS.find(x => String(x.id) === String(id))?.name || "-";

  USERS.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${u.username}</b></td>
      <td>${u.role}</td>
      <td>${locName(u.location_id)}</td>
      <td>${roleName(u.role_id)}</td>
      <td>${depName(u.fixed_department_id)}</td>
      <td>${u.is_active ? "aktiv" : "inaktiv"}</td>
      <td>
        <button class="secondary" data-reset="${u.id}">Passwort</button>
        <button class="danger" data-disable="${u.id}">Löschen</button>
      </td>
    `;
    body.appendChild(tr);
  });

  document.querySelectorAll("[data-reset]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-reset");
      const pw = prompt("Neues Passwort eingeben:");
      if (!pw) return;
      const rr = await api(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: pw })
      });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) return setMsg("userMsg", data.error || "Passwort konnte nicht gesetzt werden");
      setMsg("userMsg", "Passwort gesetzt", true);
    });
  });

  document.querySelectorAll("[data-disable]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-disable");
      if (!confirm("Benutzer wirklich löschen?")) return;
      const rr = await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) return setMsg("userMsg", data.error || "Konnte nicht löschen");
      setMsg("userMsg", "Benutzer gelöscht", true);
      await loadUsers();
    });
  });

  const editSelect = $("editUserSelect");
  if (editSelect) {
    editSelect.innerHTML = `<option value="">(bitte wählen)</option>`;
    USERS.forEach(u => {
      const o = document.createElement("option");
      o.value = u.id;
      o.textContent = u.username;
      editSelect.appendChild(o);
    });
  }

  applyUserEditSelection();
}

function applyUserEditSelection() {
  const sel = $("editUserSelect");
  if (!sel) return;
  const id = sel.value;
  const user = USERS.find(u => String(u.id) === String(id));
  if ($("editUserRole")) $("editUserRole").value = user?.role || "disponent";
  if ($("editUserLocation")) {
    $("editUserLocation").value = user?.location_id ? String(user.location_id) : "";
  }
  $("editUserDepartment").value = user?.fixed_department_id ? String(user.fixed_department_id) : "";
  applyEditRoleLocationHint();
}

// ---------------- Role permission UI ----------------
function getPermCheckboxes() {
  return {
    bookings: {
      create: $("p_bookings_create")?.checked || false,
      view: $("p_bookings_view")?.checked || false,
      export: $("p_bookings_export")?.checked || false,
      receipt: $("p_bookings_receipt")?.checked || false,
      edit: $("p_bookings_edit")?.checked || false,
      delete: $("p_bookings_delete")?.checked || false
    },
    stock: {
      view: $("p_stock_view")?.checked || false,
      overall: $("p_stock_overall")?.checked || false
    },
    cases: {
      create: $("p_cases_create")?.checked || false,
      require_employee_code: $("p_cases_employee_code")?.checked || false,
      claim: $("p_cases_claim")?.checked || false,
      edit: $("p_cases_edit")?.checked || false,
      submit: $("p_cases_submit")?.checked || false,
      approve: $("p_cases_approve")?.checked || false,
      cancel: $("p_cases_cancel")?.checked || false
    },
    masterdata: {
      manage: $("p_master_manage")?.checked || false,
      entrepreneurs_manage: $("p_master_entrepreneurs_manage")?.checked || false
    },
    users: {
      manage: $("p_users_manage")?.checked || false,
      view_department: $("p_users_view_department")?.checked || false
    },
    roles: { manage: $("p_roles_manage")?.checked || false }
  };
}

function setPermCheckboxes(perms) {
  const p = perms || {};
  $("p_bookings_create").checked = !!p?.bookings?.create;
  $("p_bookings_view").checked = !!p?.bookings?.view;
  $("p_bookings_export").checked = !!p?.bookings?.export;
  $("p_bookings_receipt").checked = !!p?.bookings?.receipt;
  $("p_bookings_edit").checked = !!p?.bookings?.edit;
  $("p_bookings_delete").checked = !!p?.bookings?.delete;

  $("p_stock_view").checked = !!p?.stock?.view;
  $("p_stock_overall").checked = !!p?.stock?.overall;

  $("p_cases_create").checked = !!p?.cases?.create;
  $("p_cases_employee_code").checked = !!p?.cases?.require_employee_code;
  $("p_cases_claim").checked = !!p?.cases?.claim;
  $("p_cases_edit").checked = !!p?.cases?.edit;
  $("p_cases_submit").checked = !!p?.cases?.submit;
  $("p_cases_approve").checked = !!p?.cases?.approve;
  $("p_cases_cancel").checked = !!p?.cases?.cancel;

  $("p_master_manage").checked = !!p?.masterdata?.manage;
  if ($("p_master_entrepreneurs_manage")) {
    $("p_master_entrepreneurs_manage").checked = !!p?.masterdata?.entrepreneurs_manage;
  }
  $("p_users_manage").checked = !!p?.users?.manage;
  if ($("p_users_view_department")) {
    $("p_users_view_department").checked = !!p?.users?.view_department;
  }
  $("p_roles_manage").checked = !!p?.roles?.manage;
}

function applyRoleToCheckboxes(roleId) {
  const role = ROLES.find(r => Number(r.id) === Number(roleId));
  if (!role) return setPermCheckboxes({});
  setPermCheckboxes(role.permissions || {});
}

// ---------------- Actions ----------------
// Roles
$("createRoleBtn")?.addEventListener("click", async () => {
  setMsg("roleMsg", "");
  const name = ($("roleName").value || "").trim();
  if (!name) return setMsg("roleMsg", "Bitte Rollenname eingeben");

  const rr = await api("/api/admin/roles", {
    method: "POST",
    body: JSON.stringify({ name, permissions: {
      bookings: { create:true, view:true, export:true, receipt:true, edit:false, delete:false },
      stock: { view:true, overall:true },
      cases: {
        create: true,
        require_employee_code: false,
        claim: false,
        edit: false,
        submit: false,
        approve: false,
        cancel: false
      },
      masterdata: { manage:false, entrepreneurs_manage:false },
      users: { manage:false },
      roles: { manage:false }
    }})
  });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("roleMsg", data.error || "Rolle konnte nicht angelegt werden");
  setMsg("roleMsg", "Rolle angelegt", true);
  $("roleName").value = "";
  await loadRoles();
  $("roleSelect").value = String(data.id);
  applyRoleToCheckboxes(data.id);
});

$("reloadRolesBtn")?.addEventListener("click", loadRoles);

$("roleSelect")?.addEventListener("change", () => {
  applyRoleToCheckboxes(Number($("roleSelect").value));
});

$("saveRoleBtn")?.addEventListener("click", async () => {
  setMsg("roleEditMsg", "");
  const id = Number($("roleSelect").value);
  if (!id) return setMsg("roleEditMsg", "Bitte Rolle auswählen");

  const permissions = getPermCheckboxes();
  const rr = await api(`/api/admin/roles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ permissions })
  });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("roleEditMsg", data.error || "Speichern fehlgeschlagen");

  setMsg("roleEditMsg", "Gespeichert", true);
  await loadRoles();
  $("roleSelect").value = String(id);
  applyRoleToCheckboxes(id);
});

$("deleteRoleBtn")?.addEventListener("click", async () => {
  setMsg("roleEditMsg", "");
  const id = Number($("roleSelect").value);
  if (!id) return setMsg("roleEditMsg", "Bitte Rolle auswählen");
  if (!confirm("Rolle wirklich löschen? (nur wenn keinem User zugewiesen)")) return;

  const rr = await api(`/api/admin/roles/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("roleEditMsg", data.error || "Löschen fehlgeschlagen");
  setMsg("roleEditMsg", "Rolle gelöscht", true);
  await loadRoles();
});

// Masterdata: create location/department
$("createLocBtn")?.addEventListener("click", async () => {
  setMsg("locMsg", "");
  const name = ($("locName").value || "").trim();
  if (!name) return setMsg("locMsg", "Bitte Standortname eingeben");

  const rr = await api("/api/admin/locations", { method: "POST", body: JSON.stringify({ name }) });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("locMsg", data.error || "Standort konnte nicht angelegt werden!");
  setMsg("locMsg", "Standort angelegt", true);
  $("locName").value = "";
  await loadLocations();
});

$("createDepBtn")?.addEventListener("click", async () => {
  setMsg("depMsg", "");
  const name = ($("depName").value || "").trim();
  if (!name) return setMsg("depMsg", "Bitte Abteilungsname eingeben");

  const rr = await api("/api/admin/departments", { method: "POST", body: JSON.stringify({ name }) });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("depMsg", data.error || "Abteilung konnte nicht angelegt werden");
  setMsg("depMsg", "Abteilung angelegt", true);
  $("depName").value = "";
  await loadDepartments();
});

$("saveEntBtn")?.addEventListener("click", async () => {
  setMsg("entMsg", "");
  const name = ($("entName").value || "").trim();
  const street = ($("entStreet").value || "").trim();
  const postal_code = ($("entPostal").value || "").trim();
  const city = ($("entCity").value || "").trim();
  if (!name) return setMsg("entMsg", "Bitte Unternehmername eingeben");

  const payload = {
    name,
    street: street || null,
    postal_code: postal_code || null,
    city: city || null
  };

  let rr;
  if (EDIT_ENTREPRENEUR_ID) {
    rr = await api(`/api/admin/entrepreneurs/${encodeURIComponent(EDIT_ENTREPRENEUR_ID)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  } else {
    rr = await api("/api/admin/entrepreneurs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("entMsg", data.error || "Speichern fehlgeschlagen");
  setMsg("entMsg", EDIT_ENTREPRENEUR_ID ? "Unternehmer aktualisiert" : "Unternehmer angelegt", true);
  EDIT_ENTREPRENEUR_ID = null;
  $("entName").value = "";
  $("entStreet").value = "";
  $("entPostal").value = "";
  $("entCity").value = "";
  await loadEntrepreneurs();
});

$("clearEntBtn")?.addEventListener("click", () => {
  EDIT_ENTREPRENEUR_ID = null;
  $("entName").value = "";
  $("entStreet").value = "";
  $("entPostal").value = "";
  $("entCity").value = "";
  setMsg("entMsg", "");
});

// Users
$("createUserBtn")?.addEventListener("click", async () => {
  setMsg("userMsg", "");
  const username = ($("uName").value || "").trim();
  const password = ($("uPass").value || "").trim();
  const role = $("uRole").value;
  const location_id = $("uLocation").value || null;
  const role_id = $("uRoleId").value || null;
  const fixed_department_id = $("uFixedDepartment").value || null;

  if (!username || !password) return setMsg("userMsg", "Username und Passwort sind Pflicht");
  if (role === "lager" && !location_id) {
    return setMsg("userMsg", "Für die Rolle Lager ist ein Standort Pflicht");
  }

  const rr = await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ username, password, role, location_id, role_id, fixed_department_id })
  });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("userMsg", data.error || "User konnte nicht angelegt werden");

  setMsg("userMsg", "User angelegt", true);
  $("uName").value = "";
  $("uPass").value = "";
  $("uFixedDepartment").value = "";
  await loadUsers();
});

$("reloadUsersBtn")?.addEventListener("click", loadUsers);
$("uRole")?.addEventListener("change", applyRoleLocationHint);
$("editUserRole")?.addEventListener("change", applyEditRoleLocationHint);

$("editUserSelect")?.addEventListener("change", applyUserEditSelection);

$("saveUserBtn")?.addEventListener("click", async () => {
  setMsg("userEditMsg", "");
  const id = $("editUserSelect").value;
  if (!id) return setMsg("userEditMsg", "Bitte Benutzer auswählen");

  const role = $("editUserRole").value;
  const location_id = $("editUserLocation").value || null;
  const fixed_department_id = $("editUserDepartment").value || null;
  if (role === "lager" && !location_id) {
    return setMsg("userEditMsg", "Für die Rolle Lager ist ein Standort Pflicht");
  }

  const rr = await api(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ role, location_id, fixed_department_id })
  });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("userEditMsg", data.error || "Speichern fehlgeschlagen");

  setMsg("userEditMsg", "Gespeichert", true);
  await loadUsers();
  $("editUserSelect").value = String(id);
  applyUserEditSelection();
});


function openReceiptPrint(compact = false) {
  setMsg("printReceiptMsg", "");
  const ref = ($("printRefId")?.value || "").trim();
  if (!ref) return setMsg("printReceiptMsg", "Bitte Vorgangs-ID oder Buchungs-ID eingeben");

  const isNumeric = /^\d+$/.test(ref);
  if (!isNumeric) return setMsg("printReceiptMsg", "Die ID muss numerisch sein");

  const refType = $("printRefType")?.value === "id" ? "id" : "caseId";
  const query = compact
    ? `/receipt.html?${refType}=${encodeURIComponent(ref)}&compact=1`
    : `/receipt.html?${refType}=${encodeURIComponent(ref)}`;

  window.open(query, "_blank", "noopener,noreferrer");
  setMsg("printReceiptMsg", compact ? "Kompakter Beleg geöffnet" : "Beleg geöffnet", true);
}

$("printReceiptStandardBtn")?.addEventListener("click", () => openReceiptPrint(false));
$("printReceiptCompactBtn")?.addEventListener("click", () => openReceiptPrint(true));

// ---------------- Init ----------------
(async function init() {
  try {
    bindTabs();
    await loadMe();
    await loadPerms();

    if (!IS_ADMIN && !PERMS?.users?.view_department) {
      window.location.href = "/app.html";
      return;
    }

    const tabBtn = (name) => document.querySelector(`.tabs button[data-tab="${name}"]`);
    if (!IS_ADMIN) {
      if (tabBtn("roles")) tabBtn("roles").style.display = "none";
      if (tabBtn("master")) tabBtn("master").style.display = "none";
      if (tabBtn("users")) {
        tabBtn("users").classList.add("active");
        tabBtn("users").click();
      }
    }

    if (IS_ADMIN) {
      await loadRoles();
      await loadLocations();
      await loadDepartments();
      await loadEntrepreneurs();
      await loadUsers();
      applyRoleLocationHint();
    } else {
      await loadLocations();
      await loadDepartments();
      await loadUsers();
    }
  } catch (e) {
    console.error(e);
    // Falls hier etwas knallt, sieht man es im Browser in der Console
  }
})();
