(function () {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  function qs(name) {
    return new URL(window.location.href).searchParams.get(name);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function showError(msg) {
    alert(msg || "Unbekannter Fehler");
  }

  function closeTabSafe() {
    try { window.close(); } catch (_) {}

    setTimeout(() => {
      if (!document.hidden) {
        if (window.history.length > 1) {
          window.history.back();
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

    let res;
    let data;
    try {
      const path = bookingId
        ? `/api/receipt/${encodeURIComponent(bookingId)}`
        : `/api/cases/${encodeURIComponent(caseId)}/receipt`;
      res = await fetch(path, {
        headers: { Authorization: "Bearer " + token }
      });
      data = await res.json();
    } catch (_) {
      return showError("Netzwerkfehler beim Laden des Belegs");
    }

    if (!res.ok) return showError(data?.error || `Beleg konnte nicht geladen werden (HTTP ${res.status})`);

    let receiptLabel = data.receipt_no || "-";
    if (data.provisional) {
      receiptLabel = data.receipt_no ? `Vorläufig ${data.receipt_no}` : "Vorläufig";
    }

    const formattedDate = data.created_at
      ? new Date(data.created_at).toLocaleDateString("de-DE")
      : "-";

    setText("placeDate", `${data.location || "-"} / ${formattedDate}`);
    setText("trailerNo", data.license_plate || "-");
    setText("receiptNoInline", receiptLabel);

    const qtyIn = Number(data.qty_in ?? 0);
    const qtyOut = Number(data.qty_out ?? 0);
    setText("qtyOutEu", String(qtyOut));
    setText("qtyInEu", String(qtyIn));
  }

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      try { window.print(); } catch (_) {}
    }
    if (e.key === "Escape") {
      closeTabSafe();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    wireButtons();
    loadReceipt();
  });
})();
