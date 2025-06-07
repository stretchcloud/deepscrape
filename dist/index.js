"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const scraper_1 = __importDefault(require("./api/routes/scraper"));
const crawler_routes_1 = __importDefault(require("./api/routes/crawler.routes"));
const logger_1 = require("./utils/logger");
const queue_service_1 = require("./services/queue.service");
// Load environment variables
dotenv_1.default.config();
// Create Express app
const app = (0, express_1.default)();
// Set up logging - ensure logs directory exists
const logsDir = path_1.default.join(__dirname, '..', 'logs');
if (!fs_1.default.existsSync(logsDir)) {
    fs_1.default.mkdirSync(logsDir, { recursive: true });
}
const accessLogStream = fs_1.default.createWriteStream(path_1.default.join(logsDir, 'access.log'), { flags: 'a' });
// Configuration
const PORT = process.env.PORT || 3000;
// Middleware
app.use((0, helmet_1.default)()); // Security headers
app.use((0, cors_1.default)()); // CORS support
app.use(express_1.default.json({ limit: '50mb' })); // Parse JSON request bodies
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded request bodies
app.use((0, morgan_1.default)('combined', { stream: accessLogStream })); // HTTP request logging
// API Routes
app.use('/api', scraper_1.default);
app.use('/api/crawl', crawler_routes_1.default);
// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Service is running' });
});
// Error handling middleware
app.use((err, req, res, next) => {
    logger_1.logger.error(`Unhandled error: ${err.message}`);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});
// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});
// Initialize the crawl queue and worker
async function initializeCrawlQueue() {
    try {
        // Initialize queue
        await (0, queue_service_1.initQueue)();
        // Start worker to process crawl jobs
        const worker = (0, queue_service_1.initializeWorker)();
        logger_1.logger.info('Crawl queue and worker initialized successfully');
        // Graceful shutdown
        const shutdown = async () => {
            logger_1.logger.info('Shutting down enhanced queue service...');
            await (0, queue_service_1.closeQueue)();
            process.exit(0);
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
    catch (error) {
        logger_1.logger.error(`Failed to initialize crawl queue: ${error}`);
    }
}
// Start server
app.listen(PORT, async () => {
    logger_1.logger.info(`Server running on port ${PORT}`);
    logger_1.logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    // Initialize crawl queue after server starts
    await initializeCrawlQueue();
});
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger_1.logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});
// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger_1.logger.error(`Uncaught Exception: ${err.message}`);
    // Graceful shutdown
    process.exit(1);
});
