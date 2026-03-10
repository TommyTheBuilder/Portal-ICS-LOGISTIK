const { Pool } = require("pg");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://palettenuser:DEIN_STARKES_PASSWORT@localhost:5432/palettenmanagement";

const sslEnabled =
  process.env.PG_SSL === "true" ||
  (!Object.prototype.hasOwnProperty.call(process.env, "PG_SSL") &&
    process.env.NODE_ENV === "production");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

module.exports = { pool };
