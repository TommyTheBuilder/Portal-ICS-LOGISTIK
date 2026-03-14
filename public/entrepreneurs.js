const token = localStorage.getItem("token");
if (!token) window.location.href = "/login.html";

function $(id) { return document.getElementById(id); }

function api(path, opts = {}) {
  return fetch(path, {
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      ...(opts.headers || {})
    }
  });
}

function setMsg(text, ok = false) {
  const el = $("msg");
  if (!el) return;
  el.style.color = ok ? "#0a7a2f" : "#b00020";
  el.textContent = text || "";
}

let editId = null;

function fillForm(item) {
  $("entName").value = item?.name || "";
  $("entStreet").value = item?.street || "";
  $("entPostal").value = item?.postal_code || "";
  $("entCity").value = item?.city || "";
}

function resetForm() {
  editId = null;
  fillForm(null);
}

async function ensurePermission() {
  const r = await api("/api/my-permissions", { method: "GET", headers: {} });
  const perms = r.ok ? await r.json() : {};
  if (!perms?.masterdata?.entrepreneurs_manage) {
    window.location.href = "/app.html";
  }
}

async function loadList() {
  const r = await api("/api/entrepreneurs/manage", { method: "GET", headers: {} });
  const rows = r.ok ? await r.json() : [];
  $("body").innerHTML = rows.map((x) => {
    const adr = [x.street, x.postal_code, x.city].filter(Boolean).join(", ") || "-";
    return `<tr>
      <td>${x.name}</td>
      <td>${adr}</td>
      <td>
        <button class="secondary" data-edit="${x.id}" style="width:auto;">Bearbeiten</button>
        <button class="secondary" data-del="${x.id}" style="width:auto;">Löschen</button>
      </td>
    </tr>`;
  }).join("");

  $("body").querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.edit);
      const item = rows.find((r) => Number(r.id) === id);
      if (!item) return;
      editId = id;
      fillForm(item);
      setMsg("");
    });
  });

  $("body").querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.del);
      if (!confirm("Frachtführer wirklich löschen?")) return;
      const rr = await api(`/api/entrepreneurs/manage/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await rr.json().catch(() => ({}));
      if (!rr.ok) return setMsg(data?.error || "Löschen fehlgeschlagen");
      setMsg("Frachtführer gelöscht", true);
      if (editId === id) resetForm();
      await loadList();
    });
  });
}

$("saveBtn").addEventListener("click", async () => {
  setMsg("");
  const name = ($("entName").value || "").trim();
  const street = ($("entStreet").value || "").trim();
  const postal_code = ($("entPostal").value || "").trim();
  const city = ($("entCity").value || "").trim();

  if (!name) return setMsg("Bitte Frachtführername eingeben");

  const body = JSON.stringify({
    name,
    street: street || null,
    postal_code: postal_code || null,
    city: city || null
  });

  const rr = editId
    ? await api(`/api/entrepreneurs/manage/${encodeURIComponent(editId)}`, { method: "PUT", body })
    : await api("/api/entrepreneurs/manage", { method: "POST", body });

  const data = await rr.json().catch(() => ({}));
  if (!rr.ok) return setMsg(data?.error || "Speichern fehlgeschlagen");

  setMsg(editId ? "Frachtführer aktualisiert" : "Frachtführer angelegt", true);
  resetForm();
  await loadList();
});

$("resetBtn").addEventListener("click", resetForm);
$("backBtn").addEventListener("click", () => window.location.href = "/app.html");
$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
});

(async () => {
  await ensurePermission();
  await loadList();
})();
