const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

const pool = hasDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : false
    })
  : new Pool({
      user: process.env.DB_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME || "chakali_store",
      password: process.env.DB_PASSWORD || "Sanika@2006",
      port: Number(process.env.DB_PORT || 5432)
    });

module.exports = pool;
