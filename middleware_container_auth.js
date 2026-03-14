const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const ADMIN_PERMISSION_KEY = String(process.env.ADMIN_PERMISSION_KEY || "integration.container_login").trim();
const ADMIN_AUTH_DATABASE_URL = String(process.env.ADMIN_AUTH_DATABASE_URL || "").trim();
const ADMIN_AUTH_QUERY = String(process.env.ADMIN_AUTH_QUERY || "").trim();
const SESSION_COOKIE_NAME = String(process.env.ADMIN_SESSION_COOKIE_NAME || "connect.sid").trim();
const JWT_SECRET = process.env.JWT_SECRET || "7xK9!mP2#vQ8@zL4$rT1%wN6&bH3*eF9";

const DEFAULT_ADMIN_AUTH_QUERY = `
SELECT u.id AS user_id, u.username
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE u.id = $1
  AND p.permission_key = $2
LIMIT 1
`;

let adminPool = null;

function getAdminPool() {
  if (!ADMIN_AUTH_DATABASE_URL) {
    throw new Error("ADMIN_AUTH_DATABASE_URL missing");
  }
  if (!adminPool) {
    adminPool = new Pool({ connectionString: ADMIN_AUTH_DATABASE_URL });
  }
  return adminPool;
}

function parseCookieHeader(cookieHeader) {
  const result = {};
  if (!cookieHeader) return result;

  for (const part of String(cookieHeader).split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (!key) continue;
    result[key] = rawValue;
  }

  return result;
}

function normalizeSessionId(rawCookieValue) {
  if (!rawCookieValue) return null;

  let value = String(rawCookieValue).trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // ignore malformed percent encoding and continue with original value
  }

  if (value.startsWith("s:")) {
    value = value.slice(2);
    const dotIndex = value.lastIndexOf(".");
    if (dotIndex > 0) {
      value = value.slice(0, dotIndex);
    }
  }

  return value || null;
}

async function loadSessionPayloadBySid(client, sid) {
  const candidates = [
    `SELECT sess FROM session WHERE sid = $1 LIMIT 1`,
    `SELECT sess FROM sessions WHERE sid = $1 LIMIT 1`
  ];

  for (const sql of candidates) {
    try {
      const r = await client.query(sql, [sid]);
      if (r.rowCount) {
        return r.rows[0].sess || null;
      }
    } catch {
      // try next candidate table
    }
  }

  return null;
}

function extractUserIdFromSession(sessionPayload) {
  if (!sessionPayload) return null;

  const sess = typeof sessionPayload === "string"
    ? (() => {
        try { return JSON.parse(sessionPayload); } catch { return null; }
      })()
    : sessionPayload;

  if (!sess || typeof sess !== "object") return null;

  const candidates = [
    sess.userId,
    sess.user_id,
    sess.uid,
    sess?.user?.id,
    sess?.passport?.user,
    sess?.passport?.user?.id,
    sess?.auth?.userId,
    sess?.auth?.user_id
  ];

  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isInteger(id) && id > 0) {
      return id;
    }
  }

  return null;
}

function extractUserFromBearer(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  try {
    const claims = jwt.verify(token, JWT_SECRET);
    const id = Number(claims?.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return {
      id,
      username: claims?.username ? String(claims.username) : "",
      role: claims?.role ? String(claims.role) : ""
    };
  } catch {
    return null;
  }
}

async function resolvePrincipal(req, client) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const rawCookie = cookies[SESSION_COOKIE_NAME];
  const sid = normalizeSessionId(rawCookie);

  if (sid) {
    const sessionPayload = await loadSessionPayloadBySid(client, sid);
    const sessionUserId = extractUserIdFromSession(sessionPayload);
    if (sessionUserId) {
      return {
        source: "session",
        id: sessionUserId,
        username: "",
        role: ""
      };
    }
  }

  const bearerUser = extractUserFromBearer(req);
  if (bearerUser) {
    return { source: "bearer", ...bearerUser };
  }

  return null;
}

async function resolveUserByAuth(req) {
  const client = getAdminPool();
  const principal = await resolvePrincipal(req, client);
  if (!principal) return { status: 401, error: "No session" };

  const sql = ADMIN_AUTH_QUERY || DEFAULT_ADMIN_AUTH_QUERY;
  const permissionMatch = await client.query(sql, [principal.id, ADMIN_PERMISSION_KEY]);

  if (!permissionMatch.rowCount) {
    return { status: 403, error: "Missing permission" };
  }

  const row = permissionMatch.rows[0] || {};
  const resolvedUserId = Number(row.user_id || row.id || principal.id);

  let username = row.username ? String(row.username) : principal.username;
  let role = row.role ? String(row.role) : principal.role;

  if (!username || !role) {
    const userLookup = await client.query(
      `SELECT id, username, role FROM users WHERE id = $1 LIMIT 1`,
      [resolvedUserId]
    );
    if (!userLookup.rowCount) {
      return { status: 401, error: "No session" };
    }
    if (!username) username = String(userLookup.rows[0].username || "");
    if (!role) role = String(userLookup.rows[0].role || "");
  }

  if (!username) {
    return { status: 401, error: "No session" };
  }

  return {
    status: 200,
    user: {
      id: resolvedUserId,
      username,
      role,
      permission: ADMIN_PERMISSION_KEY,
      auth_source: principal.source
    }
  };
}

function containerPermissionRequired(req, res, next) {
  resolveUserByAuth(req)
    .then((result) => {
      if (result.status === 401) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      if (result.status === 403) {
        return res.status(403).json({ error: "No Permissions" });
      }
      req.containerUser = result.user;
      return next();
    })
    .catch((err) => {
      console.error("containerPermissionRequired error:", err);
      return res.status(500).json({ error: "Permission check failed" });
    });
}

module.exports = {
  containerPermissionRequired,
  DEFAULT_ADMIN_AUTH_QUERY
};
