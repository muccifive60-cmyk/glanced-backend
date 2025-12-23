import { pool } from "./config/db.js";

async function test() {
  try {
    const res = await pool.query("select 1");
    console.log("✅ DB CONNECTED:", res.rows);
    process.exit(0);
  } catch (err) {
    console.error("❌ DB ERROR:", err);
    process.exit(1);
  }
}

test();
