(function () {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  function qs(name) {
    return new URL(window.location.href).searchParams.get(name);
  }
  function byId(id) { return document.getElementById(id); }

  function showError(msg) {
    const box = byId("errBox");
    if (!box) { alert(msg); return; }
    byId("errText").textContent = msg || "Unbekannter Fehler";
    box.style.display = "block";
  }

  function closeTabSafe() {
    // 1) Versuchen zu schließen (geht nur bei window.open() / Script-opened Tabs)
    try { window.close(); } catch (_) {}

    // 2) Wenn noch offen: zurück
    setTimeout(() => {
      if (!document.hidden) {
        // history.length > 1 = meist "Zurück" möglich
        if (window.history.length > 1) {
          window.history.back();
          // 3) Wenn "Zurück" nix bringt (z.B. direkt geöffnet):
          setTimeout(() => {
            if (!document.hidden) window.location.href = "/app.html";
          }, 200);
        } else {
          window.location.href = "/app.html";
        }
      }
    }, 120);
  }

  function wireButtons() {
    const btnPrint = byId("btnPrint");
    const btnClose = byId("btnClose");

    if (btnPrint) {
      btnPrint.addEventListener("click", () => {
        try {
          window.focus();
          window.print();
        } catch (e) {
          alert("Drucken nicht möglich: " + (e?.message || e));
        }
      });
    }

    if (btnClose) {
      btnClose.addEventListener("click", closeTabSafe);
    }
  }

  async function loadReceipt() {
    const bookingId = qs("id");
    const caseId = qs("caseId");
    if (!bookingId && !caseId) return showError("Keine Beleg-ID übergeben");

    let res, data;
    try {
      const path = bookingId
        ? `/api/receipt/${encodeURIComponent(bookingId)}`
        : `/api/cases/${encodeURIComponent(caseId)}/receipt`;
      res = await fetch(path, {
        headers: { "Authorization": "Bearer " + token }
      });
      data = await res.json();
    } catch (e) {
      return showError("Netzwerkfehler beim Laden des Belegs");
    }

    if (!res.ok) return showError(data?.error || `Beleg konnte nicht geladen werden (HTTP ${res.status})`);

    let receiptLabel = data.receipt_no || "-";
    if (data.provisional) {
      receiptLabel = data.receipt_no ? `Vorläufig ${data.receipt_no}` : "Vorläufig";
    }
    byId("receiptNo").textContent = receiptLabel;
    byId("dateTime").textContent = data.created_at ? new Date(data.created_at).toLocaleString("de-DE") : "-";
    byId("location").textContent = data.location || "-";
    byId("department").textContent = data.department || "-";
    const userName = data.aviso_created_by || data.username || "-";
    const employeeCode = data.employee_code ? ` / ${data.employee_code}` : "";
    byId("username").textContent = `${userName}${employeeCode}`;
    byId("plate").textContent = data.license_plate || "-";
    const entLines = [];
    if (data.entrepreneur) entLines.push(data.entrepreneur);
    const addressLine1 = data.entrepreneur_street || "";
    const addressLine2 = [data.entrepreneur_postal_code, data.entrepreneur_city].filter(Boolean).join(" ");
    if (addressLine1) entLines.push(addressLine1);
    if (addressLine2) entLines.push(addressLine2);
    byId("entrepreneur").textContent = entLines.length ? entLines.join("\n") : "-";
    byId("note").textContent = data.note || "";

    const qtyIn = Number(data.qty_in ?? 0);
    const qtyOut = Number(data.qty_out ?? 0);
    byId("qtyIn").textContent = String(qtyIn);
    byId("qtyOut").textContent = String(qtyOut);

    if (Array.isArray(data.lines) && data.lines.length > 0) {
      const details = data.lines
        .map(l => `${l.type === "IN" ? "Eingang" : "Ausgang"}: ${l.quantity}`)
        .join(" • ");
      byId("details").textContent = details;
    } else {
      byId("details").textContent = `Eingang: ${qtyIn} • Ausgang: ${qtyOut}`;
    }
  }

  // Extra: STRG+P als Print
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      try { window.print(); } catch (_) {}
    }
    if (e.key === "Escape") {
      // ESC = schließen
      closeTabSafe();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    wireButtons();
    loadReceipt();
  });
})();
