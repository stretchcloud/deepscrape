"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Ensure logs directory exists
const logDir = 'logs';
if (!fs_1.default.existsSync(logDir)) {
    fs_1.default.mkdirSync(logDir, { recursive: true });
}
const logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
    transports: [
        // Console transport for development
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, stack }) => {
                return `${timestamp} ${level}: ${stack ?? message}`;
            })),
        }),
        // File transport for errors
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, 'error.log'),
            level: 'error'
        }),
        // File transport for all logs
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, 'combined.log')
        }),
    ],
});
exports.logger = logger;
