import winston from 'winston';
import 'winston-daily-rotate-file';
import fs from 'fs';

/**
 * Logger configuration.
 *
 * - File logging is opt-in via LOG_TO_FILE (default true). Set it false — or run
 *   on a read-only/ephemeral filesystem — and the logger stays console-only
 *   instead of crashing at import time (the previous version mkdir'd and attached
 *   file transports unconditionally).
 * - File transports rotate by size/age (winston-daily-rotate-file) so logs can
 *   never grow unbounded and fill the disk.
 * - An 'error' listener prevents a transport write error (e.g. ENOSPC) from
 *   bubbling up as an uncaughtException and crash-looping the process.
 */

const logToFile = process.env.LOG_TO_FILE !== 'false' && process.env.NODE_ENV !== 'test';
const logDir = process.env.LOG_DIRECTORY || 'logs';
const maxSize = process.env.LOG_MAX_SIZE || '20m';
const maxFiles = process.env.LOG_MAX_FILES || '14d';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        return `${timestamp} ${level}: ${stack ?? message}`;
      })
    ),
  })
];

let fileLoggingEnabled = false;
if (logToFile) {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    transports.push(
      new winston.transports.DailyRotateFile({
        dirname: logDir,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize,
        maxFiles,
        zippedArchive: true
      }),
      new winston.transports.DailyRotateFile({
        dirname: logDir,
        filename: 'combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize,
        maxFiles,
        zippedArchive: true
      })
    );
    fileLoggingEnabled = true;
  } catch (err) {
    // Read-only / unavailable filesystem — fall back to console-only.

    console.warn(`File logging disabled (${(err as Error).message}); logging to console only`);
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
});

// A transport-level error (e.g. disk full) must never crash the process.
logger.on('error', (err) => {

  console.error(`Logger transport error: ${err?.message ?? err}`);
});

if (fileLoggingEnabled) {
  logger.info(`File logging enabled (dir=${logDir}, rotate=${maxSize}/${maxFiles})`);
}

export { logger };
