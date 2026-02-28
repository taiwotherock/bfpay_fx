import mysql from 'mysql2/promise';
import dotenv from 'dotenv';


dotenv.config();

// Create MySQL connection pool

// Connection Pool
const poolConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PWD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 30000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
}

export let pool = mysql.createPool(poolConfig);

export const restartPool = async () => {
  try {
    await pool.end();
    // Recreate pool
    pool = mysql.createPool(poolConfig);
    console.log('Pool restarted');
  } catch (error) {
    console.error('Pool restart failed:', error);
  }
};



// Add pool monitoring
pool.on('connection', (connection) => {
  console.log('New connection established as id ' + connection.threadId);
});


// Check pool status
console.log('Pool config:', pool.config);
