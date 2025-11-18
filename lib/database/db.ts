import { Pool } from 'pg';

// Database configuration using environment variables
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? true : false,
  // Connection pool settings optimized for high-frequency updates
  max: 50, // Reduced maximum connections to prevent database overload
  min: 2,   // Minimum connections to keep warm
  idleTimeoutMillis: 10000, // Close idle clients after 10 seconds
  connectionTimeoutMillis: 5000, // Increased timeout for connection acquisition
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
