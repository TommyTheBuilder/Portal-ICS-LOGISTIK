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

const USER_FILTERS = {
  username: "",
  departmentId: "",
  locationId: ""
};

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
  $("me").textContent = `${me.username} • ${me.business_role_name || "-"}`;
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

  populateUserFilters();
  renderUsersTable();

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

  populateUserFilters();
  renderUsersTable();
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
      if (!confirm("Frachtführer wirklich löschen?")) return;
      const rr = await api(`/api/admin/entrepreneurs/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) return setMsg("entMsg", data.error || "Löschen fehlgeschlagen");
      setMsg("entMsg", "Frachtführer gelöscht", true);
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

  const editUserRoleSel = $("editUserRoleId");
  if (editUserRoleSel) {
    editUserRoleSel.innerHTML = `<option value="">(keine)</option>`;
    ROLES.forEach(role => {
      const o = document.createElement("option");
      o.value = role.id;
      o.textContent = role.name;
      editUserRoleSel.appendChild(o);
    });
  }

  // apply permissions for currently selected
  if (sel && sel.value) applyRoleToCheckboxes(Number(sel.value));
}

function getFilteredUsers() {
  const usernameFilter = USER_FILTERS.username.trim().toLowerCase();
  return USERS.filter(u => {
    const usernameMatches = !usernameFilter
      || String(u.username || "").toLowerCase().includes(usernameFilter);
    const departmentMatches = !USER_FILTERS.departmentId
      || String(u.fixed_department_id || "") === String(USER_FILTERS.departmentId);
    const locationMatches = !USER_FILTERS.locationId
      || String(u.location_id || "") === String(USER_FILTERS.locationId);
    return usernameMatches && departmentMatches && locationMatches;
  });
}

function renderUsersTable() {
  const body = $("usersBody");
  if (!body) return;
  body.innerHTML = "";

  const locName = (id) => LOCATIONS.find(x => String(x.id) === String(id))?.name || "-";
  const roleName = (id) => ROLES.find(x => String(x.id) === String(id))?.name || "-";
  const depName = (id) => DEPARTMENTS.find(x => String(x.id) === String(id))?.name || "-";

  getFilteredUsers().forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${u.username}</b></td>
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

  body.querySelectorAll("[data-reset]").forEach(btn => {
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

  body.querySelectorAll("[data-disable]").forEach(btn => {
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
}

function populateUserFilters() {
  const depSel = $("usersFilterDepartment");
  if (depSel) {
    depSel.innerHTML = `<option value="">(alle Abteilungen)</option>`;
    DEPARTMENTS.forEach(d => {
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = d.name;
      depSel.appendChild(o);
    });
    depSel.value = USER_FILTERS.departmentId;
  }

  const locSel = $("usersFilterLocation");
  if (locSel) {
    locSel.innerHTML = `<option value="">(alle Standorte)</option>`;
    LOCATIONS.forEach(l => {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name;
      locSel.appendChild(o);
    });
    locSel.value = USER_FILTERS.locationId;
  }
}

async function loadUsers() {
  const r = await api("/api/admin/users", { method: "GET", headers: {} });
  USERS = r.ok ? await r.json() : [];

  renderUsersTable();

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
  if ($("editUserLocation")) {
    $("editUserLocation").value = user?.location_id ? String(user.location_id) : "";
  }
  $("editUserRoleId").value = user?.role_id ? String(user.role_id) : "";
  $("editUserDepartment").value = user?.fixed_department_id ? String(user.fixed_department_id) : "";
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
      delete: $("p_bookings_delete")?.checked || false,
      translogica: $("p_bookings_translogica")?.checked || false
    },
    stock: {
      view: $("p_stock_view")?.checked || false,
      overall: $("p_stock_overall")?.checked || false
    },
    cases: {
      create: $("p_cases_create")?.checked || false,
      internal_transfer: $("p_cases_internal_transfer")?.checked || false,
      require_employee_code: $("p_cases_employee_code")?.checked || false,
      claim: $("p_cases_claim")?.checked || false,
      edit: $("p_cases_edit")?.checked || false,
      submit: $("p_cases_submit")?.checked || false,
      approve: $("p_cases_approve")?.checked || false,
      cancel: $("p_cases_cancel")?.checked || false,
      delete: $("p_cases_delete")?.checked || false
    },
    filters: {
      all_locations: $("p_filters_all_locations")?.checked || false
    },
    masterdata: {
      manage: $("p_master_manage")?.checked || false,
      entrepreneurs_manage: $("p_master_entrepreneurs_manage")?.checked || false
    },
    users: {
      manage: $("p_users_manage")?.checked || false,
      view_department: $("p_users_view_department")?.checked || false
    },
    roles: { manage: $("p_roles_manage")?.checked || false },
    admin: { full_access: $("p_admin_full_access")?.checked || false }
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
  if ($("p_bookings_translogica")) {
    $("p_bookings_translogica").checked = !!p?.bookings?.translogica;
  }

  $("p_stock_view").checked = !!p?.stock?.view;
  $("p_stock_overall").checked = !!p?.stock?.overall;

  $("p_cases_create").checked = !!p?.cases?.create;
  if ($("p_cases_internal_transfer")) {
    $("p_cases_internal_transfer").checked = !!p?.cases?.internal_transfer;
  }
  $("p_cases_employee_code").checked = !!p?.cases?.require_employee_code;
  $("p_cases_claim").checked = !!p?.cases?.claim;
  $("p_cases_edit").checked = !!p?.cases?.edit;
  $("p_cases_submit").checked = !!p?.cases?.submit;
  $("p_cases_approve").checked = !!p?.cases?.approve;
  $("p_cases_cancel").checked = !!p?.cases?.cancel;
  if ($("p_cases_delete")) {
    $("p_cases_delete").checked = !!p?.cases?.delete;
  }
  if ($("p_filters_all_locations")) {
    $("p_filters_all_locations").checked = !!p?.filters?.all_locations;
  }

  $("p_master_manage").checked = !!p?.masterdata?.manage;
  if ($("p_master_entrepreneurs_manage")) {
    $("p_master_entrepreneurs_manage").checked = !!p?.masterdata?.entrepreneurs_manage;
  }
  $("p_users_manage").checked = !!p?.users?.manage;
  if ($("p_users_view_department")) {
    $("p_users_view_department").checked = !!p?.users?.view_department;
  }
  $("p_roles_manage").checked = !!p?.roles?.manage;
  if ($("p_admin_full_access")) {
    $("p_admin_full_access").checked = !!p?.admin?.full_access;
  }
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
      bookings: { create:true, view:true, export:true, receipt:true, edit:false, delete:false, translogica:false },
      stock: { view:true, overall:true },
      cases: {
        create: true,
        internal_transfer: false,
        require_employee_code: false,
        claim: false,
        edit: false,
        submit: false,
        approve: false,
        cancel: false,
        delete: false
      },
      filters: { all_locations: false },
      masterdata: { manage:false, entrepreneurs_manage:false },
      users: { manage:false, view_department:false },
      roles: { manage:false },
      admin: { full_access:false }
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
  if (!name) return setMsg("entMsg", "Bitte Frachtführername eingeben");

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
  setMsg("entMsg", EDIT_ENTREPRENEUR_ID ? "Frachtführer aktualisiert" : "Frachtführer angelegt", true);
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
  const location_id = $("uLocation").value || null;
  const role_id = $("uRoleId").value || null;
  const fixed_department_id = $("uFixedDepartment").value || null;

  if (!username || !password) return setMsg("userMsg", "Username und Passwort sind Pflicht");
  if (!role_id) return setMsg("userMsg", "Bitte Business-Rolle auswählen");

  const rr = await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ username, password, role: "disponent", location_id, role_id, fixed_department_id })
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
$("usersFilterUsername")?.addEventListener("input", (e) => {
  USER_FILTERS.username = e.target.value || "";
  renderUsersTable();
});
$("usersFilterDepartment")?.addEventListener("change", (e) => {
  USER_FILTERS.departmentId = e.target.value || "";
  renderUsersTable();
});
$("usersFilterLocation")?.addEventListener("change", (e) => {
  USER_FILTERS.locationId = e.target.value || "";
  renderUsersTable();
});
$("editUserSelect")?.addEventListener("change", applyUserEditSelection);

$("printReceiptDriverBtn")?.addEventListener("click", () => {
  setMsg("printReceiptMsg", "");
  window.open("/receipt.html?driverSlip=1", "_blank", "noopener,noreferrer");
  setMsg("printReceiptMsg", "Fahrer Palettenschein geöffnet", true);
});

$("printReceiptWarehouseBtn")?.addEventListener("click", () => {
  setMsg("printReceiptMsg", "");
  window.open("/receipt.html?warehouseSlip=1", "_blank", "noopener,noreferrer");
  setMsg("printReceiptMsg", "Lager Palettenschein geöffnet", true);
});

$("saveUserBtn")?.addEventListener("click", async () => {
  setMsg("userEditMsg", "");
  const id = $("editUserSelect").value;
  if (!id) return setMsg("userEditMsg", "Bitte Benutzer auswählen");

  const location_id = $("editUserLocation").value || null;
  const role_id = $("editUserRoleId").value || null;
  const fixed_department_id = $("editUserDepartment").value || null;
  if (!role_id) return setMsg("userEditMsg", "Bitte Business-Rolle auswählen");

  const rr = await api(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ location_id, role_id, fixed_department_id })
  });
  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg("userEditMsg", data.error || "Speichern fehlgeschlagen");

  setMsg("userEditMsg", "Gespeichert", true);
  await loadUsers();
  $("editUserSelect").value = String(id);
  applyUserEditSelection();
});



// ---------------- Init ----------------
(async function init() {
  try {
    bindTabs();
    await loadMe();
    await loadPerms();

    const hasFullAdminAccess = !!PERMS?.admin?.full_access || IS_ADMIN;

    if (!hasFullAdminAccess && !PERMS?.users?.view_department) {
      window.location.href = "/app.html";
      return;
    }

    const tabBtn = (name) => document.querySelector(`.tabs button[data-tab="${name}"]`);
    if (!hasFullAdminAccess) {
      if (tabBtn("roles")) tabBtn("roles").style.display = "none";
      if (tabBtn("master")) tabBtn("master").style.display = "none";
      if (tabBtn("users")) {
        tabBtn("users").classList.add("active");
        tabBtn("users").click();
      }
    }

    if (hasFullAdminAccess) {
      await loadRoles();
      await loadLocations();
      await loadDepartments();
      await loadEntrepreneurs();
      await loadUsers();
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
