const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");
const path = require("path");
const { randomUUID } = require("crypto");

const { pool } = require("./db_pg");
const { authRequired, adminRequired, JWT_SECRET } = require("./middleware_auth");
const { requirePermission } = require("./middleware_permissions");

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || "100kb";
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 10);
const PRODUCT_TYPES = ["euro", "h1", "gitterbox"];

function corsOriginResolver(origin, callback) {
  if (CORS_ORIGIN === "*") return callback(null, true);
  const allowed = CORS_ORIGIN.split(",").map((x) => x.trim()).filter(Boolean);
  if (!origin || allowed.includes(origin)) return callback(null, true);
  return callback(new Error("Not allowed by CORS"));
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: corsOriginResolver }));
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.static(path.join(__dirname, "public")));

const httpServer = require("http").createServer(app);
const io = require("socket.io")(httpServer, {
  cors: {
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map((x) => x.trim()).filter(Boolean)
  }
});

io.on("connection", (socket) => {
  socket.on("joinLocation", (locationId) => {
    if (locationId) socket.join(`loc:${locationId}`);
  });

  socket.on("joinUser", (userId) => {
    const parsedUserId = Number(userId);
    if (Number.isInteger(parsedUserId) && parsedUserId > 0) {
      socket.join(`user:${parsedUserId}`);
    }
  });
});

async function q(sql, params = []) {
  return pool.query(sql, params);
}

const LOGIN_ATTEMPTS = new Map();

function tooManyLoginAttempts(ip) {
  const now = Date.now();
  const current = LOGIN_ATTEMPTS.get(ip);
  if (!current || current.expiresAt <= now) {
    LOGIN_ATTEMPTS.set(ip, { count: 1, expiresAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  current.count += 1;
  LOGIN_ATTEMPTS.set(ip, current);
  return current.count > LOGIN_MAX_ATTEMPTS;
}

function clearLoginAttempts(ip) {
  LOGIN_ATTEMPTS.delete(ip);
}

function normalizeProductType(value) {
  const normalized = String(value || "euro").trim().toLowerCase();
  if (!PRODUCT_TYPES.includes(normalized)) {
    return { ok: false, msg: "product_type invalid" };
  }
  return { ok: true, productType: normalized };
}

// ---------- Helpers ----------
async function nextReceiptNo(locationId) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const datePart = `${y}${m}${d}`;
  const loc = await q(`SELECT name FROM locations WHERE id=$1`, [locationId]);
  const locName = loc.rowCount ? String(loc.rows[0].name || "") : "";
  const letterMatch = locName.match(/[A-Za-zÄÖÜ]/);
  const numberMatch = locName.match(/\d+/);
  const locLetter = letterMatch ? letterMatch[0].toUpperCase() : "L";
  const locNumber = numberMatch ? numberMatch[0] : String(locationId);
  const locationIndicator = `${locLetter}${locNumber}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(`SELECT next_no FROM receipt_seq WHERE id=1 FOR UPDATE`);
    const no = Number(row.rows[0].next_no);
    await client.query(`UPDATE receipt_seq SET next_no = next_no + 1 WHERE id=1`);
    await client.query("COMMIT");
    return `ICS${locationIndicator}-${datePart}-${String(no).padStart(6, "0")}`;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function previewReceiptNo(locationId) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const datePart = `${y}${m}${d}`;
  const loc = await q(`SELECT name FROM locations WHERE id=$1`, [locationId]);
  const locName = loc.rowCount ? String(loc.rows[0].name || "") : "";
  const letterMatch = locName.match(/[A-Za-zÄÖÜ]/);
  const numberMatch = locName.match(/\d+/);
  const locLetter = letterMatch ? letterMatch[0].toUpperCase() : "L";
  const locNumber = numberMatch ? numberMatch[0] : String(locationId);
  const locationIndicator = `${locLetter}${locNumber}`;

  const row = await q(`SELECT next_no FROM receipt_seq WHERE id=1`);
  const no = Number(row.rows[0]?.next_no || 1);
  return `ICS${locationIndicator}-${datePart}-${String(no).padStart(6, "0")}`;
}

function normalizePlate(plateRaw) {
  const plate = String(plateRaw || "").trim().toUpperCase();
  if (!plate) return { ok: false, msg: "Kennzeichen ist Pflicht" };
  if (plate.includes("-")) return { ok: false, msg: "Kennzeichen bitte ohne '-' eingeben" };
  if (/\s/.test(plate)) return { ok: false, msg: "Kennzeichen bitte ohne Leerzeichen eingeben" };
  if (!/^[A-Z0-9ÄÖÜ]+$/.test(plate)) return { ok: false, msg: "Kennzeichen nur Buchstaben/Zahlen (ohne Sonderzeichen)" };
  if (plate.length < 3) return { ok: false, msg: "Kennzeichen zu kurz" };
  return { ok: true, plate };
}

function normalizeEmployeeCode(codeRaw) {
  const code = safeTrim(codeRaw);
  if (!code) return null;
  const normalized = code.toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(normalized)) {
    return { ok: false, msg: "Mitarbeiterkürzel muss genau 2 Zeichen haben (Buchstaben/Zahlen)" };
  }
  return { ok: true, code: normalized };
}

function safeTrim(v) {
  const s = (v === undefined || v === null) ? "" : String(v);
  const t = s.trim();
  return t ? t : null;
}

function normalizeEmail(emailRaw) {
  const email = safeTrim(emailRaw);
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, msg: "E-Mail-Adresse ungültig" };
  }
  return { ok: true, email: normalized };
}

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const mailer = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    })
  : null;

async function notifyStatus3(caseRow) {
  if (!mailer || !SMTP_FROM) return;
  try {
    const recipients = await q(
      `SELECT email FROM users WHERE is_active=TRUE AND email IS NOT NULL AND fixed_department_id=$1`,
      [caseRow.department_id]
    );
    if (recipients.rowCount === 0) return;

    const info = await q(
      `SELECT d.name AS department, l.name AS location
       FROM departments d, locations l
       WHERE d.id=$1 AND l.id=$2`,
      [caseRow.department_id, caseRow.location_id]
    );
    const department = info.rowCount ? info.rows[0].department : `Abteilung ${caseRow.department_id}`;
    const location = info.rowCount ? info.rows[0].location : `Standort ${caseRow.location_id}`;

    const emails = recipients.rows.map((r) => r.email).filter(Boolean);
    if (emails.length === 0) return;

    const subject = `Neue Buchung in Prüfung (Status 3) – ${department}`;
    const text = [
      `Für die Abteilung "${department}" gibt es einen neuen Vorgang im Status 3 (In Prüfung).`,
      `Standort: ${location}`,
      `Vorgangs-ID: ${caseRow.id}`,
      `Kennzeichen: ${caseRow.license_plate}`,
      `Unternehmer: ${caseRow.entrepreneur || "-"}`,
      `Menge Eingang: ${caseRow.qty_in}`,
      `Menge Ausgang: ${caseRow.qty_out}`,
      `Notiz: ${caseRow.note || "-"}`,
      "",
      "Bitte im System prüfen."
    ].join("\n");

    await mailer.sendMail({
      from: SMTP_FROM,
      to: emails.join(","),
      subject,
      text
    });
  } catch (err) {
    console.error("Status-3-Mailversand fehlgeschlagen:", err);
  }
}

async function createStatus3Notifications(caseRow) {
  try {
    const recipients = await q(
      `SELECT id FROM users WHERE is_active=TRUE AND fixed_department_id=$1`,
      [caseRow.department_id]
    );
    if (recipients.rowCount === 0) return;

    const info = await q(
      `SELECT d.name AS department, l.name AS location
       FROM departments d, locations l
       WHERE d.id=$1 AND l.id=$2`,
      [caseRow.department_id, caseRow.location_id]
    );
    const department = info.rowCount ? info.rows[0].department : `Abteilung ${caseRow.department_id}`;
    const location = info.rowCount ? info.rows[0].location : `Standort ${caseRow.location_id}`;
    const message = `Aviso #${caseRow.id} ist jetzt in Prüfung (${department}, ${location}).`;

    for (const recipient of recipients.rows) {
      const inserted = await q(
        `INSERT INTO user_notifications (user_id, case_id, title, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, case_id, title, message, is_read, created_at`,
        [recipient.id, caseRow.id, "Aviso in Prüfung", message]
      );
      io.to(`user:${recipient.id}`).emit("notificationCreated", inserted.rows[0]);
    }
  } catch (err) {
    console.error("Status-3-Notification fehlgeschlagen:", err);
  }
}

async function pruneNotificationsForUser(userId) {
  const deletedByStatus = await q(
    `DELETE FROM user_notifications n
     USING booking_cases c
     WHERE n.case_id = c.id
       AND n.user_id = $1
       AND c.status <> 3
     RETURNING n.id`,
    [userId]
  );

  const deletedOrphans = await q(
    `DELETE FROM user_notifications n
     WHERE n.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM booking_cases c WHERE c.id = n.case_id
       )
     RETURNING n.id`,
    [userId]
  );

  const deletedIds = [
    ...deletedByStatus.rows.map((row) => row.id),
    ...deletedOrphans.rows.map((row) => row.id)
  ];
  if (deletedIds.length > 0) {
    io.to(`user:${userId}`).emit("notificationsDeleted", {
      notification_ids: deletedIds
    });
  }
}

function emitNotificationsDeleted(payloadByUser) {
  for (const [userId, notificationIds] of payloadByUser.entries()) {
    io.to(`user:${userId}`).emit("notificationsDeleted", {
      notification_ids: notificationIds
    });
  }
}

async function deleteNotificationsForCase(caseId) {
  const deleted = await q(
    `DELETE FROM user_notifications
     WHERE case_id=$1
     RETURNING id, user_id`,
    [caseId]
  );

  if (deleted.rowCount === 0) return;

  const payloadByUser = new Map();
  for (const row of deleted.rows) {
    if (!payloadByUser.has(row.user_id)) payloadByUser.set(row.user_id, []);
    payloadByUser.get(row.user_id).push(row.id);
  }
  emitNotificationsDeleted(payloadByUser);
}

async function getMyPermissions(user) {
  if (user.role === "admin") {
    return {
      bookings: { create: true, view: true, export: true, receipt: true, edit: true, delete: true },
      stock: { view: true, overall: true },
      cases: {
        create: true,
        claim: true,
        edit: true,
        submit: true,
        approve: true,
        cancel: true,
        require_employee_code: false
      },
      masterdata: { manage: true, entrepreneurs_manage: true },
      users: { manage: true, view_department: true },
      roles: { manage: true }
    };
  }

  if (!user.role_id) {
    return {
      bookings: { create: true, view: true, export: true, receipt: true, edit: false, delete: false },
      stock: { view: true, overall: true },
      cases: {
        create: true,
        claim: false,
        edit: false,
        submit: false,
        approve: false,
        cancel: false,
        require_employee_code: false
      },
      masterdata: { manage: false, entrepreneurs_manage: false },
      users: { manage: false, view_department: false },
      roles: { manage: false }
    };
  }

  const r = await q(`SELECT permissions FROM roles WHERE id=$1`, [user.role_id]);
  const raw = (r.rowCount ? r.rows[0].permissions : {}) || {};

  // Fehlende Schalter mit Defaults auffüllen, damit bestehende Rollen nicht "plötzlich" Features verlieren.
  const defaults = {
    bookings: { create: true, view: true, export: true, receipt: true, edit: false, delete: false },
    stock: { view: true, overall: true },
    cases: {
      create: true,
      claim: false,
      edit: false,
      submit: false,
      approve: false,
      cancel: false,
      require_employee_code: false
    },
    masterdata: { manage: false, entrepreneurs_manage: false },
    users: { manage: false, view_department: false },
    roles: { manage: false }
  };

  function merge(b, o) {
    const out = { ...b };
    for (const k of Object.keys(o || {})) {
      if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) out[k] = merge(b[k] || {}, o[k]);
      else out[k] = o[k];
    }
    return out;
  }

  const p = merge(defaults, raw);
  return p;
}

// ---------- AUTH ----------
app.post("/api/login", async (req, res) => {
  const clientIp = String(req.ip || req.headers["x-forwarded-for"] || "unknown");
  if (tooManyLoginAttempts(clientIp)) {
    return res.status(429).json({ error: "Zu viele Login-Versuche. Bitte später erneut versuchen." });
  }

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username/password required" });

  const r = await q(
    `SELECT id, username, password_hash, role, location_id, role_id, is_active
     FROM users WHERE username=$1`,
    [username]
  );

  const user = r.rows[0];
  if (!user || user.is_active !== true) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  clearLoginAttempts(clientIp);

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      location_id: user.location_id,
      role_id: user.role_id || null
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      location_id: user.location_id,
      role_id: user.role_id || null
    }
  });
});

app.get("/api/me", authRequired, async (req, res) => {
  const r = await q(
    `SELECT id, username, role, location_id, role_id, is_active
     FROM users WHERE id=$1`,
    [req.user.id]
  );
  const user = r.rows[0];
  if (!user || user.is_active !== true) return res.status(401).json({ error: "Not authenticated" });
  res.json(user);
});

app.get("/api/theme", async (req, res) => {
  const ipAddress = String(req.ip || req.headers["x-forwarded-for"] || "unknown");
  const pref = await q(
    `SELECT theme FROM ip_preferences WHERE ip_address=$1 LIMIT 1`,
    [ipAddress]
  );
  res.json({ theme: pref.rowCount ? pref.rows[0].theme : "light" });
});

app.put("/api/theme", async (req, res) => {
  const nextTheme = String(req.body?.theme || "").trim().toLowerCase();
  if (!["light", "dark"].includes(nextTheme)) {
    return res.status(400).json({ error: "invalid theme" });
  }
  const ipAddress = String(req.ip || req.headers["x-forwarded-for"] || "unknown");
  await q(
    `INSERT INTO ip_preferences (ip_address, theme)
     VALUES ($1, $2)
     ON CONFLICT (ip_address)
     DO UPDATE SET theme=EXCLUDED.theme, updated_at=now()`,
    [ipAddress, nextTheme]
  );
  res.json({ ok: true, theme: nextTheme });
});

app.get("/api/my-permissions", authRequired, async (req, res) => {
  const perms = await getMyPermissions(req.user);
  res.json(perms);
});

app.get("/api/notifications", authRequired, async (req, res) => {
  await pruneNotificationsForUser(req.user.id);

  const rows = (await q(
    `SELECT id, user_id, case_id, title, message, is_read, created_at
     FROM user_notifications
     WHERE user_id=$1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user.id]
  )).rows;
  const unread = rows.filter((item) => !item.is_read).length;
  res.json({ items: rows, unread });
});

app.put("/api/notifications/:id/read", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  await q(
    `UPDATE user_notifications
     SET is_read=TRUE, read_at=now()
     WHERE id=$1 AND user_id=$2`,
    [id, req.user.id]
  );
  res.json({ ok: true });
});

// ---------- LOCATIONS ----------
app.get("/api/locations", authRequired, async (req, res) => {
  res.json((await q(`SELECT id, name FROM locations ORDER BY name`)).rows);
});

app.post("/api/admin/locations", authRequired, adminRequired, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  const nm = String(name).trim();
  const r = await q(`INSERT INTO locations (name) VALUES ($1) RETURNING id`, [nm]);
  res.json({ id: r.rows[0].id, name: nm });
});

app.delete("/api/admin/locations/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const used = await q(`SELECT 1 FROM bookings WHERE location_id=$1 LIMIT 1`, [id]);
  if (used.rowCount > 0) return res.status(400).json({ error: "Standort hat bereits Buchungen und kann nicht gelöscht werden" });

  const usedCases = await q(`SELECT 1 FROM booking_cases WHERE location_id=$1 LIMIT 1`, [id]);
  if (usedCases.rowCount > 0) return res.status(400).json({ error: "Standort hat bereits Vorgänge und kann nicht gelöscht werden" });

  await q(`DELETE FROM locations WHERE id=$1`, [id]);
  res.json({ ok: true });
});

// ---------- DEPARTMENTS ----------
app.get("/api/departments", authRequired, async (req, res) => {
  res.json((await q(`SELECT id, name FROM departments ORDER BY name`)).rows);
});

app.post("/api/admin/departments", authRequired, adminRequired, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  const nm = String(name).trim();
  const r = await q(`INSERT INTO departments (name) VALUES ($1) RETURNING id`, [nm]);
  res.json({ id: r.rows[0].id, name: nm });
});

app.delete("/api/admin/departments/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  await q(`DELETE FROM departments WHERE id=$1`, [id]);
  res.json({ ok: true });
});

// ---------- ENTREPRENEURS ----------
app.get("/api/entrepreneurs", authRequired, async (req, res) => {
  res.json((await q(`SELECT id, name, street, postal_code, city FROM entrepreneurs ORDER BY name`)).rows);
});

app.post("/api/entrepreneurs", authRequired, async (req, res) => {
  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  const r = await q(
    `INSERT INTO entrepreneurs (name, street, postal_code, city)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE
     SET street = COALESCE(EXCLUDED.street, entrepreneurs.street),
         postal_code = COALESCE(EXCLUDED.postal_code, entrepreneurs.postal_code),
         city = COALESCE(EXCLUDED.city, entrepreneurs.city)
     RETURNING id, name, street, postal_code, city`,
    [name, street, postal_code, city]
  );
  res.json(r.rows[0]);
});

app.get("/api/entrepreneurs/manage", authRequired, requirePermission("masterdata.entrepreneurs_manage"), async (req, res) => {
  res.json((await q(`SELECT id, name, street, postal_code, city FROM entrepreneurs ORDER BY name`)).rows);
});

app.post("/api/entrepreneurs/manage", authRequired, requirePermission("masterdata.entrepreneurs_manage"), async (req, res) => {
  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  try {
    const r = await q(
      `INSERT INTO entrepreneurs (name, street, postal_code, city)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, street, postal_code, city`,
      [name, street, postal_code, city]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "Unternehmer existiert bereits" });
    throw e;
  }
});

app.put("/api/entrepreneurs/manage/:id", authRequired, requirePermission("masterdata.entrepreneurs_manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  try {
    const r = await q(
      `UPDATE entrepreneurs
       SET name=$1, street=$2, postal_code=$3, city=$4
       WHERE id=$5
       RETURNING id, name, street, postal_code, city`,
      [name, street, postal_code, city, id]
    );
    if (!r.rowCount) return res.status(404).json({ error: "Unternehmer nicht gefunden" });
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "Unternehmer existiert bereits" });
    throw e;
  }
});

app.delete("/api/entrepreneurs/manage/:id", authRequired, requirePermission("masterdata.entrepreneurs_manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  await q(`DELETE FROM entrepreneurs WHERE id=$1`, [id]);
  res.json({ ok: true });
});

app.get("/api/admin/entrepreneurs", authRequired, adminRequired, async (req, res) => {
  res.json((await q(`SELECT id, name, street, postal_code, city FROM entrepreneurs ORDER BY name`)).rows);
});

app.post("/api/admin/entrepreneurs", authRequired, adminRequired, async (req, res) => {
  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);
  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  try {
    const r = await q(
      `INSERT INTO entrepreneurs (name, street, postal_code, city)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, street, postal_code, city`,
      [name, street, postal_code, city]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "Unternehmer existiert bereits" });
    throw e;
  }
});

app.put("/api/admin/entrepreneurs/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const name = safeTrim(req.body?.name);
  const street = safeTrim(req.body?.street);
  const postal_code = safeTrim(req.body?.postal_code);
  const city = safeTrim(req.body?.city);

  if (!name) return res.status(400).json({ error: "Name erforderlich" });

  await q(
    `UPDATE entrepreneurs
     SET name=$1, street=$2, postal_code=$3, city=$4
     WHERE id=$5`,
    [name, street, postal_code, city, id]
  );
  res.json({ ok: true });
});

app.delete("/api/admin/entrepreneurs/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  await q(`DELETE FROM entrepreneurs WHERE id=$1`, [id]);
  res.json({ ok: true });
});

// ---------- ROLES (Admin) ----------
app.get("/api/admin/roles", authRequired, adminRequired, async (req, res) => {
  const rows = (await q(`SELECT id, name, permissions, created_at FROM roles ORDER BY name`)).rows;
  res.json(rows);
});

app.post("/api/admin/roles", authRequired, adminRequired, async (req, res) => {
  const { name, permissions } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name required" });

  const roleName = String(name).trim();
  const perms = (permissions && typeof permissions === "object") ? permissions : {};

  try {
    const r = await q(
      `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb)
       RETURNING id, name, permissions`,
      [roleName, JSON.stringify(perms)]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "role name already exists" });
    throw e;
  }
});

app.put("/api/admin/roles/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const { name, permissions } = req.body || {};
  const roleName = name ? String(name).trim() : null;
  const perms = (permissions && typeof permissions === "object") ? permissions : null;

  await q(
    `UPDATE roles
     SET name = COALESCE($1, name),
         permissions = COALESCE($2::jsonb, permissions)
     WHERE id=$3`,
    [roleName, perms ? JSON.stringify(perms) : null, id]
  );

  res.json({ ok: true });
});

app.delete("/api/admin/roles/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const used = await q(`SELECT 1 FROM users WHERE role_id=$1 LIMIT 1`, [id]);
  if (used.rowCount > 0) return res.status(400).json({ error: "role is assigned to users" });

  await q(`DELETE FROM roles WHERE id=$1`, [id]);
  res.json({ ok: true });
});

// ---------- USERS (Admin) ----------
app.get("/api/admin/users", authRequired, async (req, res) => {
  if (req.user.role === "admin") {
    const rows = (await q(
      `SELECT id, username, role, location_id, role_id, is_active, created_at, email, fixed_department_id
       FROM users
       ORDER BY username`
    )).rows;
    return res.json(rows);
  }

  const perms = await getMyPermissions(req.user);
  if (!perms?.users?.view_department) return res.status(403).json({ error: "No Permissions" });

  const fixedDepartmentId = req.user.fixed_department_id;
  if (!fixedDepartmentId) return res.status(400).json({ error: "Kein fixe Abteilung gesetzt" });

  const rows = (await q(
    `SELECT id, username, role, location_id, role_id, is_active, created_at, email, fixed_department_id
     FROM users
     WHERE fixed_department_id=$1
     ORDER BY username`,
    [fixedDepartmentId]
  )).rows;
  return res.json(rows);
});

app.post("/api/admin/users", authRequired, adminRequired, async (req, res) => {
  const {
    username,
    password,
    role = "disponent",
    location_id = null,
    role_id = null,
    email,
    fixed_department_id = null
  } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username + password required" });
  if (!["admin", "disponent", "lager"].includes(role)) return res.status(400).json({ error: "invalid role" });

  const name = String(username).trim();
  if (name.length < 3) return res.status(400).json({ error: "username too short" });

  const hash = await bcrypt.hash(String(password), 10);
  const emailCheck = normalizeEmail(email);
  if (emailCheck && emailCheck.ok === false) return res.status(400).json({ error: emailCheck.msg });
  if (role === "lager" && (location_id === null || location_id === undefined || location_id === "")) {
    return res.status(400).json({ error: "Standort ist für Rolle Lager Pflicht" });
  }
  const fixedDepartmentId = (fixed_department_id === null || fixed_department_id === undefined || fixed_department_id === "")
    ? null
    : Number(fixed_department_id);
  if (fixedDepartmentId) {
    const depExists = await q(`SELECT 1 FROM departments WHERE id=$1`, [fixedDepartmentId]);
    if (depExists.rowCount === 0) return res.status(400).json({ error: "Abteilung nicht gefunden" });
  }

  try {
    const r = await q(
      `INSERT INTO users (username, password_hash, role, location_id, role_id, is_active, email, fixed_department_id)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7)
       RETURNING id, username, role, location_id, role_id, is_active, email, fixed_department_id`,
      [
        name,
        hash,
        role,
        (location_id === null || location_id === undefined || location_id === "") ? null : Number(location_id),
        (role_id === null || role_id === undefined || role_id === "") ? null : Number(role_id),
        emailCheck?.email || null,
        fixedDepartmentId
      ]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e && e.code === "23505") return res.status(400).json({ error: "username already exists" });
    throw e;
  }
});

app.put("/api/admin/users/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const { role, location_id, is_active, role_id, email, fixed_department_id } = req.body || {};
  if (role && !["admin", "disponent", "lager"].includes(role)) return res.status(400).json({ error: "invalid role" });

  if (role !== undefined || Object.prototype.hasOwnProperty.call(req.body || {}, "location_id")) {
    const existing = await q(`SELECT role, location_id FROM users WHERE id=$1`, [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Not found" });
    const current = existing.rows[0];
    const nextRole = role !== undefined ? role : current.role;
    const nextLocation = Object.prototype.hasOwnProperty.call(req.body || {}, "location_id")
      ? ((location_id === null || location_id === undefined || location_id === "") ? null : Number(location_id))
      : current.location_id;
    if (nextRole === "lager" && !nextLocation) {
      return res.status(400).json({ error: "Standort ist für Rolle Lager Pflicht" });
    }
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (role !== undefined) {
    updates.push(`role=$${idx++}`);
    values.push(role ?? null);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "location_id")) {
    const locValue = (location_id === null || location_id === undefined || location_id === "") ? null : Number(location_id);
    updates.push(`location_id=$${idx++}`);
    values.push(locValue);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "is_active")) {
    if (typeof is_active !== "boolean") return res.status(400).json({ error: "invalid is_active" });
    updates.push(`is_active=$${idx++}`);
    values.push(is_active);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "role_id")) {
    const roleValue = (role_id === null || role_id === undefined || role_id === "") ? null : Number(role_id);
    updates.push(`role_id=$${idx++}`);
    values.push(roleValue);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "email")) {
    const emailCheck = normalizeEmail(email);
    if (emailCheck && emailCheck.ok === false) return res.status(400).json({ error: emailCheck.msg });
    updates.push(`email=$${idx++}`);
    values.push(emailCheck?.email || null);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "fixed_department_id")) {
    const fixedDepartmentId = (fixed_department_id === null || fixed_department_id === undefined || fixed_department_id === "")
      ? null
      : Number(fixed_department_id);
    if (fixedDepartmentId) {
      const depExists = await q(`SELECT 1 FROM departments WHERE id=$1`, [fixedDepartmentId]);
      if (depExists.rowCount === 0) return res.status(400).json({ error: "Abteilung nicht gefunden" });
    }
    updates.push(`fixed_department_id=$${idx++}`);
    values.push(fixedDepartmentId);
  }

  if (updates.length === 0) return res.status(400).json({ error: "no changes" });

  values.push(id);
  await q(
    `UPDATE users SET ${updates.join(", ")} WHERE id=$${idx}`,
    values
  );

  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (id === req.user.id) return res.status(400).json({ error: "cannot delete yourself" });

  await q(`DELETE FROM users WHERE id=$1`, [id]);
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/reset-password", authRequired, adminRequired, async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!id) return res.status(400).json({ error: "invalid id" });
  if (!password) return res.status(400).json({ error: "password required" });

  const hash = await bcrypt.hash(String(password), 10);
  await q(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, id]);
  res.json({ ok: true });
});

// ---------- WORKFLOW CASES (Status 1-4) ----------
app.get("/api/cases", authRequired, async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const status = req.query.status ? Number(req.query.status) : null;
  const mine = String(req.query.mine || "") === "1";
  const search = (req.query.search || "").trim();

  if (!location_id) return res.status(400).json({ error: "location_id required" });

  if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = [`c.location_id=$1`];
  const params = [location_id];
  let idx = 2;

  if (status) { where.push(`c.status=$${idx}`); params.push(status); idx++; }
  if (mine) { where.push(`c.created_by=$${idx}`); params.push(req.user.id); idx++; }

  if (search) {
    const like = `%${search}%`;
    const isNum = /^\d+$/.test(search);
    if (isNum) {
      where.push(`(c.id=$${idx} OR c.license_plate ILIKE $${idx + 1} OR COALESCE(c.entrepreneur,'') ILIKE $${idx + 1} OR COALESCE(c.note,'') ILIKE $${idx + 1})`);
      params.push(Number(search));
      params.push(like);
      idx += 2;
    } else {
      where.push(`(c.license_plate ILIKE $${idx} OR COALESCE(c.entrepreneur,'') ILIKE $${idx} OR COALESCE(c.note,'') ILIKE $${idx})`);
      params.push(like);
      idx += 1;
    }
  }

  const rows = (await q(
    `
    SELECT
      c.*,
      COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      l.name AS location,
      COALESCE(u.username, '(gelöscht)') AS created_by_name,
      COALESCE(cu.username, '(gelöscht)') AS claimed_by_name,
      COALESCE(su.username, '(gelöscht)') AS submitted_by_name,
      COALESCE(au.username, '(gelöscht)') AS approved_by_name
    FROM booking_cases c
    LEFT JOIN departments d ON d.id=c.department_id
    JOIN locations l ON l.id=c.location_id
    LEFT JOIN users u ON u.id=c.created_by
    LEFT JOIN users cu ON cu.id=c.claimed_by
    LEFT JOIN users su ON su.id=c.submitted_by
    LEFT JOIN users au ON au.id=c.approved_by
    WHERE ${where.join(" AND ")}
    ORDER BY c.id DESC
    LIMIT 500
    `,
    params
  )).rows;

  res.json(rows);
});

app.get("/api/cases/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const result = await q(
    `
    SELECT
      c.*,
      COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      l.name AS location,
      COALESCE(u.username, '(gelöscht)') AS created_by_name,
      COALESCE(cu.username, '(gelöscht)') AS claimed_by_name,
      COALESCE(su.username, '(gelöscht)') AS submitted_by_name,
      COALESCE(au.username, '(gelöscht)') AS approved_by_name
    FROM booking_cases c
    LEFT JOIN departments d ON d.id=c.department_id
    JOIN locations l ON l.id=c.location_id
    LEFT JOIN users u ON u.id=c.created_by
    LEFT JOIN users cu ON cu.id=c.claimed_by
    LEFT JOIN users su ON su.id=c.submitted_by
    LEFT JOIN users au ON au.id=c.approved_by
    WHERE c.id=$1
    LIMIT 1
    `,
    [id]
  );

  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const row = result.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(row.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json(row);
});

app.post("/api/cases", authRequired, async (req, res) => {
  const perms = await getMyPermissions(req.user);
  if (!perms?.cases?.create) return res.status(403).json({ error: "Keine Berechtigung" });

  const { location_id, department_id, license_plate, entrepreneur, note, qty_in, qty_out, employee_code, product_type } = req.body || {};
  const locId = Number(location_id);
  const depId = Number(department_id);

  if (!locId || !depId) return res.status(400).json({ error: "location_id + department_id required" });

  const plateCheck = normalizePlate(license_plate);
  if (!plateCheck.ok) return res.status(400).json({ error: plateCheck.msg });

  const inQty = Number(qty_in ?? 0);
  const outQty = Number(qty_out ?? 0);
  if (!Number.isInteger(inQty) || inQty < 0) return res.status(400).json({ error: "qty_in invalid" });
  if (!Number.isInteger(outQty) || outQty < 0) return res.status(400).json({ error: "qty_out invalid" });
  if (inQty === 0 && outQty === 0) return res.status(400).json({ error: "qty_in oder qty_out muss > 0 sein" });

  const productTypeCheck = normalizeProductType(product_type);
  if (!productTypeCheck.ok) return res.status(400).json({ error: productTypeCheck.msg });

  const employeeCodeCheck = normalizeEmployeeCode(employee_code);
  if (employeeCodeCheck && employeeCodeCheck.ok === false) {
    return res.status(400).json({ error: employeeCodeCheck.msg });
  }
  if (perms?.cases?.require_employee_code && !employeeCodeCheck?.code) {
    return res.status(400).json({ error: "Mitarbeiterkürzel (2-stellig) ist Pflicht" });
  }

  if (req.user.role !== "admin" && req.user.location_id && locId !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const r = await q(
    `
    INSERT INTO booking_cases (location_id, department_id, created_by, status, license_plate, entrepreneur, note, qty_in, qty_out, employee_code, product_type)
    VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id
    `,
    [locId, depId, req.user.id, plateCheck.plate, safeTrim(entrepreneur), safeTrim(note), inQty, outQty, employeeCodeCheck?.code || null, productTypeCheck.productType]
  );

  if (safeTrim(entrepreneur)) {
    await q(
      `
      INSERT INTO entrepreneur_history (location_id, department_id, created_by, entrepreneur, license_plate, qty_in, qty_out, product_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [locId, depId, req.user.id, safeTrim(entrepreneur), plateCheck.plate, inQty, outQty, productTypeCheck.productType]
    );
  }

  io.to(`loc:${locId}`).emit("casesUpdated", { location_id: locId });
  res.json({ id: r.rows[0].id });
});

app.put("/api/cases/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const existing = await q(`SELECT * FROM booking_cases WHERE id=$1`, [id]);
  if (existing.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const c = existing.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(c.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const perms = await getMyPermissions(req.user);
  const { action, department_id, license_plate, entrepreneur, note, qty_in, qty_out, product_type } = req.body || {};

  const inQty = qty_in !== undefined ? Number(qty_in) : null;
  const outQty = qty_out !== undefined ? Number(qty_out) : null;

  if (action === "edit") {
    if (!perms?.cases?.edit) return res.status(403).json({ error: "Keine Berechtigung" });
    if (![1, 2].includes(Number(c.status))) return res.status(400).json({ error: "Nur in Status 1/2 editierbar" });

    let plate = null;
    if (license_plate !== undefined) {
      const check = normalizePlate(license_plate);
      if (!check.ok) return res.status(400).json({ error: check.msg });
      plate = check.plate;
    }

    if (inQty !== null && (!Number.isInteger(inQty) || inQty < 0)) return res.status(400).json({ error: "qty_in invalid" });
    if (outQty !== null && (!Number.isInteger(outQty) || outQty < 0)) return res.status(400).json({ error: "qty_out invalid" });

    const productTypeCheck = product_type !== undefined ? normalizeProductType(product_type) : null;
    if (productTypeCheck && !productTypeCheck.ok) return res.status(400).json({ error: productTypeCheck.msg });

    await q(
      `
      UPDATE booking_cases
      SET department_id = COALESCE($1, department_id),
          license_plate = COALESCE($2, license_plate),
          entrepreneur = COALESCE($3, entrepreneur),
          note = COALESCE($4, note),
          qty_in = COALESCE($5, qty_in),
          qty_out = COALESCE($6, qty_out),
          product_type = COALESCE($7, product_type),
          updated_at = now()
      WHERE id=$8
      `,
      [
        department_id ? Number(department_id) : null,
        plate,
        safeTrim(entrepreneur),
        safeTrim(note),
        inQty,
        outQty,
        productTypeCheck?.productType || null,
        id
      ]
    );

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  if (action === "claim") {
    if (!perms?.cases?.claim) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) !== 1) return res.status(400).json({ error: "Nur aus Status 1 möglich" });

    await q(
      `UPDATE booking_cases SET status=2, claimed_by=$1, claimed_at=now(), updated_at=now() WHERE id=$2`,
      [req.user.id, id]
    );

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  if (action === "submit") {
    if (!perms?.cases?.submit) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) !== 2) return res.status(400).json({ error: "Nur aus Status 2 möglich" });

    await q(
      `UPDATE booking_cases SET status=3, submitted_by=$1, submitted_at=now(), updated_at=now() WHERE id=$2`,
      [req.user.id, id]
    );

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    void notifyStatus3(c);
    void createStatus3Notifications(c);
    return res.json({ ok: true });
  }

  if (action === "approve") {
    if (!perms?.cases?.approve) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) !== 3) return res.status(400).json({ error: "Nur aus Status 3 möglich" });

    const receipt_no = await nextReceiptNo(c.location_id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE booking_cases
         SET status=4, approved_by=$1, approved_at=now(), receipt_no=$2, updated_at=now()
         WHERE id=$3`,
        [req.user.id, receipt_no, id]
      );

      const groupId = randomUUID();
      let line = 1;

      if (Number(c.qty_in) > 0) {
        await client.query(
          `
          INSERT INTO bookings (location_id, department_id, user_id, type, quantity, note, receipt_no, license_plate, entrepreneur, booking_group_id, line_no, product_type)
          VALUES ($1,$2,$3,'IN',$4,$5,$6,$7,$8,$9,$10,$11)
          `,
          [c.location_id, c.department_id, req.user.id, Number(c.qty_in), c.note, receipt_no, c.license_plate, c.entrepreneur, groupId, line, c.product_type || "euro"]
        );
        line++;
      }

      if (Number(c.qty_out) > 0) {
        await client.query(
          `
          INSERT INTO bookings (location_id, department_id, user_id, type, quantity, note, receipt_no, license_plate, entrepreneur, booking_group_id, line_no, product_type)
          VALUES ($1,$2,$3,'OUT',$4,$5,$6,$7,$8,$9,$10,$11)
          `,
          [c.location_id, c.department_id, req.user.id, Number(c.qty_out), c.note, receipt_no, c.license_plate, c.entrepreneur, groupId, line, c.product_type || "euro"]
        );
      }

      await client.query("COMMIT");

      io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
      io.to(`loc:${c.location_id}`).emit("stockUpdated", { location_id: c.location_id });

      // ✅ NEU: Historie/Bookings live aktualisieren
      io.to(`loc:${c.location_id}`).emit("bookingsUpdated", {
        location_id: c.location_id,
        department_id: c.department_id,
        receipt_no
      });

      await deleteNotificationsForCase(id);

      return res.json({ ok: true, receipt_no });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  if (action === "cancel") {
    if (!perms?.cases?.cancel) return res.status(403).json({ error: "Keine Berechtigung" });
    if (Number(c.status) === 4) return res.status(400).json({ error: "Gebuchte Vorgänge können nicht storniert werden" });
    if (Number(c.status) === 0) return res.status(400).json({ error: "Vorgang ist bereits storniert" });

    await q(
      `UPDATE booking_cases SET status=0, updated_at=now() WHERE id=$1`,
      [id]
    );

    await deleteNotificationsForCase(id);

    io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: "unknown action" });
});

app.delete("/api/cases/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const existing = await q(`SELECT * FROM booking_cases WHERE id=$1`, [id]);
  if (existing.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const c = existing.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(c.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const perms = await getMyPermissions(req.user);
  if (!perms?.cases?.cancel) return res.status(403).json({ error: "Keine Berechtigung" });
  await q(`DELETE FROM booking_cases WHERE id=$1`, [id]);
  await deleteNotificationsForCase(id);

  io.to(`loc:${c.location_id}`).emit("casesUpdated", { location_id: c.location_id });
  res.json({ ok: true });
});

app.get("/api/cases/:id/receipt", authRequired, requirePermission("bookings.receipt"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const r = await q(
    `
    SELECT
      c.id, c.created_at, c.license_plate, c.entrepreneur, c.note,
      c.qty_in, c.qty_out, c.employee_code, c.product_type, c.status, c.receipt_no,
      l.id AS location_id, l.name AS location,
      d.id AS department_id, COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      COALESCE(u.username, '(gelöscht)') AS aviso_created_by,
      e.street AS entrepreneur_street,
      e.postal_code AS entrepreneur_postal_code,
      e.city AS entrepreneur_city
    FROM booking_cases c
    JOIN locations l ON l.id=c.location_id
    LEFT JOIN departments d ON d.id=c.department_id
    LEFT JOIN users u ON u.id=c.created_by
    LEFT JOIN entrepreneurs e ON e.name=c.entrepreneur
    WHERE c.id=$1
    LIMIT 1
    `,
    [id]
  );

  if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const row = r.rows[0];

  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(row.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const qty_in = Number(row.qty_in ?? 0);
  const qty_out = Number(row.qty_out ?? 0);
  const isBooked = Number(row.status) === 4 && !!row.receipt_no;
  const displayReceiptNo = isBooked ? row.receipt_no : await previewReceiptNo(row.location_id);
  const lines = [];
  if (qty_in > 0) lines.push({ type: "IN", quantity: qty_in });
  if (qty_out > 0) lines.push({ type: "OUT", quantity: qty_out });

  res.json({
    receipt_no: displayReceiptNo,
    provisional: !isBooked,
    created_at: row.created_at,
    location: row.location,
    department: row.department,
    username: row.aviso_created_by,
    aviso_created_by: row.aviso_created_by,
    employee_code: row.employee_code,
    license_plate: row.license_plate,
    entrepreneur: row.entrepreneur,
    entrepreneur_street: row.entrepreneur_street,
    entrepreneur_postal_code: row.entrepreneur_postal_code,
    entrepreneur_city: row.entrepreneur_city,
    note: row.note,
    qty_in,
    qty_out,
    product_type: row.product_type || "euro",
    lines
  });
});

// ---------- STOCK ----------
app.get("/api/stock", authRequired, requirePermission("stock.view"), async (req, res) => {
  const mode = (req.query.mode || "location").toLowerCase();
  const productTypeCheck = normalizeProductType(req.query.product_type || "euro");
  if (!productTypeCheck.ok) return res.status(400).json({ error: productTypeCheck.msg });
  const productType = productTypeCheck.productType;
  const userLocationLock =
    (req.user.role !== "admin" && req.user.location_id) ? Number(req.user.location_id) : null;

  if (mode === "entrepreneur") {
    const rows = (await q(
      `
      SELECT
        COALESCE(b.entrepreneur, '') AS entrepreneur,
        COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
        COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
        COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
        COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
      FROM bookings b
      JOIN entrepreneurs e ON e.name=b.entrepreneur
      WHERE b.entrepreneur IS NOT NULL AND b.entrepreneur <> '' AND COALESCE(b.product_type, 'euro')=$1
      GROUP BY COALESCE(b.entrepreneur, '')
      ORDER BY COALESCE(b.entrepreneur, '')
      `,
      [productType]
    )).rows;

    return res.json(rows);
  }

  if (mode === "overall") {
    // Extra-Schalter: Komplett Bestand nur wenn erlaubt
    const perms = await getMyPermissions(req.user);
    if (!perms?.stock?.overall) return res.status(403).json({ error: "Keine Berechtigung" });
    const sql = userLocationLock
      ? `
        SELECT d.id AS department_id, d.name AS department,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
        FROM departments d
        LEFT JOIN bookings b ON b.department_id=d.id AND b.location_id=$1 AND COALESCE(b.product_type, 'euro')=$2
        GROUP BY d.id
        ORDER BY d.name
      `
      : `
        SELECT d.id AS department_id, d.name AS department,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
               COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
               COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
        FROM departments d
        LEFT JOIN bookings b ON b.department_id=d.id AND COALESCE(b.product_type, 'euro')=$1
        GROUP BY d.id
        ORDER BY d.name
      `;

    return res.json((await q(sql, userLocationLock ? [userLocationLock, productType] : [productType])).rows);
  }

  const location_id = Number(req.query.location_id || 0);
  if (!location_id) return res.status(400).json({ error: "location_id required for mode=location" });
  if (userLocationLock && location_id !== userLocationLock) return res.status(403).json({ error: "Forbidden" });

  const rows = (await q(
    `
    SELECT d.id AS department_id, d.name AS department,
           COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS ins,
           COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS outs,
           COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0) -
           COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS saldo
    FROM departments d
    LEFT JOIN bookings b ON b.department_id=d.id AND b.location_id=$1 AND COALESCE(b.product_type, 'euro')=$2
    GROUP BY d.id
    ORDER BY d.name
    `,
    [location_id, productType]
  )).rows;

  res.json(rows);
});

// ---------- BOOKINGS LIST (Historie aggregiert pro Beleg) ----------
app.get("/api/bookings", authRequired, requirePermission("bookings.view"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  const date_from = (req.query.date_from || "").trim();
  const date_to = (req.query.date_to || "").trim();
  const entrepreneur = (req.query.entrepreneur || "").trim();
  const license_plate = (req.query.license_plate || "").trim();
  const receipt_no = (req.query.receipt_no || "").trim();

  if (!location_id || !department_id) return res.status(400).json({ error: "location_id + department_id required" });

  if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = [`b.location_id=$1`, `b.department_id=$2`];
  const params = [location_id, department_id];
  let idx = 3;

  if (date_from) { where.push(`b.created_at >= $${idx}::date`); params.push(date_from); idx++; }
  if (date_to) { where.push(`b.created_at < ($${idx}::date + interval '1 day')`); params.push(date_to); idx++; }
  if (entrepreneur) { where.push(`COALESCE(b.entrepreneur,'') ILIKE $${idx}`); params.push(`%${entrepreneur}%`); idx++; }
  if (license_plate) { where.push(`COALESCE(b.license_plate,'') ILIKE $${idx}`); params.push(`%${license_plate}%`); idx++; }
  if (receipt_no) { where.push(`b.receipt_no ILIKE $${idx}`); params.push(`%${receipt_no}%`); idx++; }

  const rows = (await q(
    `
    SELECT
      MIN(b.id) AS id,
      MIN(b.created_at) AS created_at,
      b.receipt_no,
      MAX(b.license_plate) AS license_plate,
      MAX(b.entrepreneur) AS entrepreneur,
      MAX(b.note) AS note,
      MAX(COALESCE(u.username, '(gelöscht)')) AS "user",
      MAX(COALESCE(uc.username, '(gelöscht)')) AS aviso_created_by,
      MAX(COALESCE(ua.username, '(gelöscht)')) AS aviso_approved_by,
      MAX(bc.employee_code) AS employee_code,
      MAX(COALESCE(b.product_type, 'euro')) AS product_type,
      COALESCE(SUM(CASE WHEN b.type='IN'  THEN b.quantity END),0)  AS qty_in,
      COALESCE(SUM(CASE WHEN b.type='OUT' THEN b.quantity END),0) AS qty_out
    FROM bookings b
    LEFT JOIN users u ON u.id=b.user_id
    LEFT JOIN booking_cases bc ON bc.receipt_no=b.receipt_no
    LEFT JOIN users uc ON uc.id=bc.created_by
    LEFT JOIN users ua ON ua.id=bc.approved_by
    WHERE ${where.join(" AND ")}
    GROUP BY b.receipt_no
    ORDER BY MIN(b.id) DESC
    LIMIT 500
    `,
    params
  )).rows;

  res.json(rows);
});

// ---------- ENTREPRENEUR HISTORY ----------
app.get("/api/entrepreneur-history", authRequired, requirePermission("bookings.view"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  const entrepreneur = (req.query.entrepreneur || "").trim();
  const license_plate = (req.query.license_plate || "").trim();

  if (!location_id) return res.status(400).json({ error: "location_id required" });

  if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = [`eh.location_id=$1`];
  const params = [location_id];
  let idx = 2;

  if (department_id) { where.push(`eh.department_id=$${idx}`); params.push(department_id); idx++; }
  if (entrepreneur) { where.push(`eh.entrepreneur ILIKE $${idx}`); params.push(`%${entrepreneur}%`); idx++; }
  if (license_plate) { where.push(`eh.license_plate ILIKE $${idx}`); params.push(`%${license_plate}%`); idx++; }

  const rows = (await q(
    `
    SELECT
      MAX(eh.created_at) AS last_seen,
      eh.entrepreneur,
      eh.license_plate,
      COALESCE(eh.product_type, 'euro') AS product_type,
      COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      COALESCE(SUM(eh.qty_in), 0) AS qty_in,
      COALESCE(SUM(eh.qty_out), 0) AS qty_out,
      COALESCE(SUM(eh.qty_in), 0) - COALESCE(SUM(eh.qty_out), 0) AS soll
    FROM entrepreneur_history eh
    LEFT JOIN departments d ON d.id=eh.department_id
    WHERE ${where.join(" AND ")}
    GROUP BY eh.entrepreneur, eh.license_plate, COALESCE(eh.product_type, 'euro'), COALESCE(d.name, '(gelöschte Abteilung)')
    ORDER BY MAX(eh.created_at) DESC
    LIMIT 500
    `,
    params
  )).rows;

  res.json(rows);
});

app.get("/api/entrepreneur-history/plates", authRequired, requirePermission("bookings.view"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);

  if (!location_id) return res.status(400).json({ error: "location_id required" });

  if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const where = [`eh.location_id=$1`];
  const params = [location_id];
  let idx = 2;
  if (department_id) { where.push(`eh.department_id=$${idx}`); params.push(department_id); idx++; }

  const rows = (await q(
    `
    SELECT DISTINCT eh.license_plate
    FROM entrepreneur_history eh
    WHERE ${where.join(" AND ")} AND eh.license_plate IS NOT NULL AND eh.license_plate <> ''
    ORDER BY eh.license_plate
    `,
    params
  )).rows;

  res.json(rows);
});

// ---------- BOOKINGS EDIT (Ledger) ----------
app.put("/api/bookings/:id", authRequired, requirePermission("bookings.edit"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid id" });

  const { quantity, note, entrepreneur, license_plate } = req.body || {};

  let qty = null;
  if (quantity !== undefined && quantity !== null && quantity !== "") {
    qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "quantity must be positive integer" });
  }

  let plate = null;
  if (license_plate !== undefined && license_plate !== null && String(license_plate).trim() !== "") {
    const check = normalizePlate(license_plate);
    if (!check.ok) return res.status(400).json({ error: check.msg });
    plate = check.plate;
  }

  const existing = await q(`SELECT id, location_id, department_id, receipt_no FROM bookings WHERE id=$1`, [id]);
  if (existing.rowCount === 0) return res.status(404).json({ error: "Not found" });

  const row = existing.rows[0];
  if (req.user.role !== "admin" && req.user.location_id && Number(req.user.location_id) !== Number(row.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await q(
    `
    UPDATE bookings
    SET quantity = COALESCE($1, quantity),
        note = COALESCE($2, note),
        entrepreneur = COALESCE($3, entrepreneur),
        license_plate = COALESCE($4, license_plate)
    WHERE id=$5
    `,
    [
      qty,
      (note !== undefined ? safeTrim(note) : null),
      (entrepreneur !== undefined ? safeTrim(entrepreneur) : null),
      plate,
      id
    ]
  );

  io.to(`loc:${row.location_id}`).emit("stockUpdated", { location_id: row.location_id });

  // ✅ NEU: Historie/Bookings live aktualisieren
  io.to(`loc:${row.location_id}`).emit("bookingsUpdated", {
    location_id: row.location_id,
    department_id: row.department_id,
    receipt_no: row.receipt_no
  });

  res.json({ ok: true });
});

// ---------- RECEIPT ----------
app.get("/api/receipt/:bookingId", authRequired, requirePermission("bookings.receipt"), async (req, res) => {
  const id = Number(req.params.bookingId);

  const base = await q(`SELECT receipt_no FROM bookings WHERE id=$1`, [id]);
  if (base.rowCount === 0) return res.status(404).json({ error: "Not found" });
  const receiptNo = base.rows[0].receipt_no;

  const r = await q(
    `
    SELECT
      b.id, b.receipt_no, b.license_plate, b.entrepreneur, b.type, b.quantity, b.note, b.created_at,
      COALESCE(b.product_type, 'euro') AS product_type,
      b.booking_group_id, b.line_no,
      COALESCE(u.username, '(gelöscht)') AS username,
      l.id AS location_id, l.name AS location,
      d.id AS department_id, COALESCE(d.name, '(gelöschte Abteilung)') AS department,
      e.street AS entrepreneur_street,
      e.postal_code AS entrepreneur_postal_code,
      e.city AS entrepreneur_city,
      COALESCE(uc.username, '(gelöscht)') AS aviso_created_by,
      bc.employee_code
    FROM bookings b
    LEFT JOIN users u ON u.id=b.user_id
    JOIN locations l ON l.id=b.location_id
    LEFT JOIN departments d ON d.id=b.department_id
    LEFT JOIN entrepreneurs e ON e.name=b.entrepreneur
    LEFT JOIN booking_cases bc ON bc.receipt_no=b.receipt_no
    LEFT JOIN users uc ON uc.id=bc.created_by
    WHERE b.receipt_no = $1
    ORDER BY COALESCE(b.line_no, 999999) ASC, b.id ASC
    `,
    [receiptNo]
  );

  const rows = r.rows;
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });

  const locationId = Number(rows[0].location_id);
  if (req.user.role !== "admin" && req.user.location_id && locationId !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const first = rows[0];
  const lines = rows.map(x => ({ type: x.type, quantity: Number(x.quantity) }));

  const qty_in = lines.reduce((s, x) => s + (x.type === "IN" ? x.quantity : 0), 0);
  const qty_out = lines.reduce((s, x) => s + (x.type === "OUT" ? x.quantity : 0), 0);

  res.json({
    receipt_no: first.receipt_no,
    created_at: first.created_at,
    location: first.location,
    department: first.department,
    username: first.username,
    license_plate: first.license_plate,
    entrepreneur: first.entrepreneur,
    entrepreneur_street: first.entrepreneur_street,
    entrepreneur_postal_code: first.entrepreneur_postal_code,
    entrepreneur_city: first.entrepreneur_city,
    aviso_created_by: first.aviso_created_by,
    employee_code: first.employee_code,
    note: first.note,
    qty_in,
    qty_out,
    product_type: first.product_type || "euro",
    lines
  });
});

// ---------- EXPORTS ----------
app.get("/api/export/csv", authRequired, requirePermission("bookings.export"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  if (!location_id || !department_id) return res.status(400).json({ error: "location_id + department_id required" });

  if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const loc = await q(`SELECT name FROM locations WHERE id=$1`, [location_id]);
  const dep = await q(`SELECT name FROM departments WHERE id=$1`, [department_id]);
  if (loc.rowCount === 0 || dep.rowCount === 0) return res.status(404).json({ error: "location/department not found" });

  const rows = (await q(
    `
    SELECT b.created_at, b.receipt_no, b.license_plate, b.entrepreneur, COALESCE(u.username, '(gelöscht)') AS username, b.type, b.quantity, b.note
    FROM bookings b LEFT JOIN users u ON u.id=b.user_id
    WHERE b.location_id=$1 AND b.department_id=$2
    ORDER BY b.id ASC
    `,
    [location_id, department_id]
  )).rows;

  const parser = new Parser({ fields: ["created_at","receipt_no","license_plate","entrepreneur","username","type","quantity","note"] });
  const csv = parser.parse(rows);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${loc.rows[0].name}-${dep.rows[0].name}-buchungen.csv"`);
  res.send(csv);
});

app.get("/api/export/xlsx", authRequired, requirePermission("bookings.export"), async (req, res) => {
  const location_id = Number(req.query.location_id || 0);
  const department_id = Number(req.query.department_id || 0);
  if (!location_id || !department_id) return res.status(400).json({ error: "location_id + department_id required" });

  if (req.user.role !== "admin" && req.user.location_id && location_id !== Number(req.user.location_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const loc = await q(`SELECT name FROM locations WHERE id=$1`, [location_id]);
  const dep = await q(`SELECT name FROM departments WHERE id=$1`, [department_id]);
  if (loc.rowCount === 0 || dep.rowCount === 0) return res.status(404).json({ error: "location/department not found" });

  const rows = (await q(
    `
    SELECT b.created_at, b.receipt_no, b.license_plate, b.entrepreneur, COALESCE(u.username, '(gelöscht)') AS username, b.type, b.quantity, b.note
    FROM bookings b LEFT JOIN users u ON u.id=b.user_id
    WHERE b.location_id=$1 AND b.department_id=$2
    ORDER BY b.id ASC
    `,
    [location_id, department_id]
  )).rows;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Buchungen");
  ws.columns = [
    { header: "Datum/Zeit", key: "created_at", width: 22 },
    { header: "Belegnr.", key: "receipt_no", width: 20 },
    { header: "Kennzeichen", key: "license_plate", width: 16 },
    { header: "Unternehmer", key: "entrepreneur", width: 22 },
    { header: "Benutzer", key: "username", width: 18 },
    { header: "Typ", key: "type", width: 8 },
    { header: "Menge", key: "quantity", width: 10 },
    { header: "Notiz", key: "note", width: 30 }
  ];
  ws.addRows(rows);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${loc.rows[0].name}-${dep.rows[0].name}-buchungen.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});


async function ensureRuntimeTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS ip_preferences (
      ip_address TEXT PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      case_id INTEGER REFERENCES booking_cases(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications(user_id, created_at DESC);`);
}

const PORT = process.env.PORT || 3000;
ensureRuntimeTables()
  .then(() => {
    httpServer.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
