const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "lol_analyzer",
  password: "understand",
  port: 5433,
});

async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("✅ DB 연결 성공!", result.rows[0]);
  } catch (err) {
    console.log("❌ DB 연결 실패:", err.message);
  } finally {
    pool.end();
  }
}

testConnection();
