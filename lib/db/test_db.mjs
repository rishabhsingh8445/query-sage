import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const res = await client.query('SELECT id, share_id FROM query_history WHERE share_id IS NOT NULL');
console.log(res.rows);
await client.end();
