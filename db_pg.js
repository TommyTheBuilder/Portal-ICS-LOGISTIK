const { Pool } = require("pg");

const DATABASE_URL = process.env.NEW_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("NEW_DATABASE_URL or DATABASE_URL is not set");
}

// Falls du irgendwann die EXTERNAL URL nutzt und SSL braucht:
// Setze PG_SSL=true in Render Environment.
const ssl =
  process.env.PG_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl
});

module.exports = { pool };
