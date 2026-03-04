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

  async function fetchReceiptData() {
    const bookingId = qs("id");
    const caseId = qs("caseId");
    const receiptNo = qs("receiptNo");
    if (!bookingId && !caseId && !receiptNo) throw new Error("Keine Beleg-ID übergeben");

    const path = receiptNo
      ? `/api/receipt-by-no/${encodeURIComponent(receiptNo)}`
      : bookingId
      ? `/api/receipt/${encodeURIComponent(bookingId)}`
      : `/api/cases/${encodeURIComponent(caseId)}/receipt`;

    const res = await fetch(path, {
      headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Beleg konnte nicht geladen werden (HTTP ${res.status})`);
    return data;
  }

  async function fetchActiveTemplate() {
    const res = await fetch("/api/receipt-template", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) return null;
    return res.json();
  }

  function mapTemplateData(data) {
    const formattedDate = data.created_at
      ? new Date(data.created_at).toLocaleDateString("de-DE")
      : "-";
    const qtyIn = Number(data.qty_in ?? 0);
    const qtyOut = Number(data.qty_out ?? 0);
    const productType = String(data.product_type || "euro").toLowerCase();

    return {
      belegnummer: data.receipt_no || "-",
      datum: formattedDate,
      ortdatum: `${data.location || "-"} / ${formattedDate}`,
      kennzeichen: data.license_plate || "-",
      abteilung: data.department || "-",
      frachtfuehrer: data.entrepreneur || "-",
      notiz: data.note || "-",
      qty_in: String(qtyIn),
      qty_out: String(qtyOut),
      product_type: productType,
      non_exchangeable_qty: String(Number(data.non_exchangeable_qty || 0))
    };
  }

  function mm(v) {
    return `${Number(v || 0)}mm`;
  }

  function renderTemplate(template, values) {
    const layer = byId("templateLayer");
    if (!layer || !Array.isArray(template?.elements) || template.elements.length === 0) return false;

    layer.innerHTML = "";

    for (const el of template.elements) {
      const node = document.createElement("div");
      node.className = "tplEl";
      node.style.left = mm(el.x);
      node.style.top = mm(el.y);
      node.style.width = mm(el.w);
      node.style.height = mm(el.h);

      if (el.type === "rect" || el.type === "checkbox" || el.type === "table") {
        node.style.border = `0.3mm solid ${el.stroke || "#111"}`;
      }
      if (el.type === "line") {
        node.style.height = "0";
        node.style.borderTop = `0.3mm solid ${el.stroke || "#111"}`;
      }
      if (el.type === "table") {
        const cols = Number(el.cols || 3);
        for (let i = 1; i < cols; i++) {
          const ln = document.createElement("div");
          ln.style.position = "absolute";
          ln.style.left = `${(i * 100) / cols}%`;
          ln.style.top = "0";
          ln.style.width = "0";
          ln.style.height = "100%";
          ln.style.borderLeft = `0.3mm solid ${el.stroke || "#111"}`;
          node.appendChild(ln);
        }
      }

      const txt = el.fieldId ? (values[el.fieldId] ?? `{{${el.fieldId}}}`) : (el.text || "");
      if (["text", "multiline", "barcode"].includes(el.type)) {
        node.textContent = el.type === "barcode" ? `||| ${txt} |||` : txt;
        node.style.fontSize = `${Number(el.fontSize || 10)}pt`;
        node.style.fontWeight = el.bold ? "700" : "400";
        node.style.textAlign = el.align || "left";
        node.style.padding = mm(el.padding || 0);
        node.style.lineHeight = String(el.lineHeight || 1.2);
      }

      if (el.translationText) {
        const sub = document.createElement("div");
        sub.textContent = el.translationText;
        sub.style.fontSize = "7pt";
        sub.style.color = "#6b7280";
        node.appendChild(sub);
      }

      layer.appendChild(node);
    }

    const legacy = byId("legacyReceiptContent");
    if (legacy) legacy.classList.add("templateContentHidden");
    return true;
  }

  function renderLegacy(data) {
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
    setText("department", data.department || "-");
    setText("entrepreneur", data.entrepreneur || "-");

    const nonExchangeable = Number(data.non_exchangeable_qty ?? 0);
    const noteText = data.note || "";
    setText("note", noteText || "-");

    const nonExchangeableRow = byId("nonExchangeableRow");
    if (nonExchangeableRow) nonExchangeableRow.style.display = nonExchangeable > 0 ? "" : "none";
    if (nonExchangeable > 0) setText("nonExchangeable", String(nonExchangeable));

    const qtyIn = Number(data.qty_in ?? 0);
    const qtyOut = Number(data.qty_out ?? 0);
    const productType = String(data.product_type || "euro").toLowerCase();

    const map = {
      euro: ["qtyOutEu", "qtyInEu"],
      h1: ["qtyOutH1", "qtyInH1"],
      gitterbox: ["qtyOutGb", "qtyInGb"]
    };

    const [outId, inId] = map[productType] || map.euro;
    setText(outId, String(qtyOut));
    setText(inId, String(qtyIn));
  }

  async function loadReceipt() {
    let data;
    try {
      data = await fetchReceiptData();
    } catch (err) {
      return showError(err?.message || "Netzwerkfehler beim Laden des Belegs");
    }

    const template = await fetchActiveTemplate().catch(() => null);
    const rendered = template ? renderTemplate(template, mapTemplateData(data)) : false;
    if (!rendered) renderLegacy(data);
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
