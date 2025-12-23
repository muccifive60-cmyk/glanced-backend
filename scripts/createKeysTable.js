import 'dotenv/config';
import { pool } from "../config/db.js";

const createTable = async () => {
  const client = await pool.connect();
  try {
    console.log("Creating API Keys table...");
    
    // Create the table
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
        key_hash VARCHAR(255) NOT NULL UNIQUE,
        key_prefix VARCHAR(10) NOT NULL,
        name VARCHAR(50) DEFAULT 'Default Key',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Create index for speed
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `);

    console.log("Table 'api_keys' created successfully!");
  } catch (err) {
    console.error("Error creating table:", err);
  } finally {
    client.release();
    process.exit();
  }
};

createTable();

