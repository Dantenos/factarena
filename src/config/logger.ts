import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

export default logger;

// **Usage Example:**

// ```ts
// import logger from '../config/logger';

// logger.info('User logged in', { userId: '123' });
// logger.error('Database connection failed', { error: 'Connection timeout' });
// ```

// - **What it does**:
//   This file sets up **structured logging** using the `winston` library.
//   - Logs are saved in two formats:
//     - `error.log`: Only logs errors (e.g., failed database connections).
//     - `combined.log`: Logs all events (e.g., user login, API calls).
//   - Logs are in **JSON format** for easier parsing by monitoring tools (like ELK Stack or Grafana).

// - **Security Note**:
//   This file has **no sensitive data** — it’s just a logging configuration.
//   - Ensure that logs are stored securely and not exposed publicly.