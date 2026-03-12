const { Pool } = require("pg");

const DATABASE_URL = "postgresql://palettenuser:DEIN_STARKES_PASSWORT@localhost:5432/palettenmanagement";

const ssl =
  process.env.PG_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl,
});

module.exports = { pool };
