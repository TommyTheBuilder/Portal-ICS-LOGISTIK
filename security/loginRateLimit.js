const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;

// In-memory cache: key = normalized IP, value = { attempts: number[], blockedUntil: number }
const loginStateByIp = new Map();

function normalizeIp(ip) {
  let normalized = String(ip || "").trim();

  if (!normalized) return "unknown";

  // If multiple addresses are present, keep first one.
  if (normalized.includes(",")) {
    normalized = normalized.split(",")[0].trim();
  }

  // Normalize IPv4-mapped IPv6 addresses (::ffff:123.123.123.123).
  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice(7);
  }

  // Normalize localhost IPv6 to IPv4 form.
  if (normalized === "::1") {
    normalized = "127.0.0.1";
  }

  return normalized || "unknown";
}

function getClientIp(req) {
  // With app.set('trust proxy', true), req.ip is already proxy-aware.
  const ipFromReq = req.ip;
  const ipFromHeader = req.headers["x-forwarded-for"];
  const ipFromSocket = req.socket?.remoteAddress;

  return normalizeIp(ipFromReq || ipFromHeader || ipFromSocket || "unknown");
}

function pruneAttempts(state, now) {
  if (!state?.attempts?.length) return;
  state.attempts = state.attempts.filter((timestamp) => now - timestamp <= WINDOW_MS);
}

function checkIpBlocked(req, res, next) {
  const ip = getClientIp(req);
  req.clientIp = ip;

  const now = Date.now();
  const state = loginStateByIp.get(ip);

  if (!state) return next();

  if (state.blockedUntil && state.blockedUntil > now) {
    return res.status(429).json({
      error: "Zu viele fehlgeschlagene Login-Versuche. Bitte später erneut versuchen."
    });
  }

  if (state.blockedUntil && state.blockedUntil <= now) {
    state.blockedUntil = 0;
  }

  pruneAttempts(state, now);

  if (!state.attempts.length && !state.blockedUntil) {
    loginStateByIp.delete(ip);
  } else {
    loginStateByIp.set(ip, state);
  }

  return next();
}

function registerFailedLogin(ip) {
  const normalizedIp = normalizeIp(ip);
  const now = Date.now();

  const state = loginStateByIp.get(normalizedIp) || { attempts: [], blockedUntil: 0 };

  // If still blocked, keep blocked state untouched.
  if (state.blockedUntil && state.blockedUntil > now) {
    loginStateByIp.set(normalizedIp, state);
    return;
  }

  // If block expired, reset block flag.
  if (state.blockedUntil && state.blockedUntil <= now) {
    state.blockedUntil = 0;
  }

  pruneAttempts(state, now);
  state.attempts.push(now);

  if (state.attempts.length > MAX_ATTEMPTS) {
    state.blockedUntil = now + BLOCK_MS;
    state.attempts = [];
  }

  loginStateByIp.set(normalizedIp, state);
}

function clearFailedLogin(ip) {
  const normalizedIp = normalizeIp(ip);
  loginStateByIp.delete(normalizedIp);
}

module.exports = {
  MAX_ATTEMPTS,
  WINDOW_MS,
  BLOCK_MS,
  normalizeIp,
  getClientIp,
  checkIpBlocked,
  registerFailedLogin,
  clearFailedLogin
};
