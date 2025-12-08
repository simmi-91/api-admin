// src/database.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

// Load environment variables (dotenv is already loaded in server.js, but good practice here)
dotenv.config();

// Determine which set of environment variables to use
const isTest = process.env.NODE_ENV === "test";
const isProd = process.env.NODE_ENV === "production";

// Use development/test settings unless explicitly in production
const DB_HOST = isProd ? process.env.PROD_DB_HOST : process.env.DEV_DB_HOST;
const DB_USER = isProd ? process.env.PROD_DB_USER : process.env.DEV_DB_USER;
const DB_PASSWORD = isProd
  ? process.env.PROD_DB_PASSWORD
  : process.env.DEV_DB_PASSWORD;
const DB_NAME = isProd ? process.env.PROD_DB_NAME : process.env.DEV_DB_NAME;
const DB_PORT = isProd
  ? process.env.PROD_DB_PORT || 3306
  : process.env.DEV_DB_PORT || 3306;

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  // If connection details are missing, log an error but don't crash in test environment
  if (!isTest) {
    console.error(
      "Missing critical database environment variables. Check your .env file."
    );
    // In a real app, you might throw an error or exit the process here
  }
}

const poolConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(poolConfig);

// Test the connection when the server starts (unless in test mode)
if (!isTest) {
  pool
    .getConnection()
    .then((connection) => {
      console.log(
        `Database connection successful to: ${DB_NAME} on ${DB_HOST}:${DB_PORT} (Env: ${
          process.env.NODE_ENV || "development"
        })`
      );
      connection.release();
    })
    .catch((err) => {
      console.error(
        `Database connection FAILED. Please ensure Dockerized MySQL is running. Error:`,
        err.message
      );
    });
}

export default pool;
