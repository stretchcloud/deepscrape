"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = void 0;
const logger_1 = require("../../utils/logger");
/**
 * Middleware to validate API key
 */
const apiKeyAuth = (req, res, next) => {
    try {
        // Get API key from environment
        const validApiKey = process.env.API_KEY;
        // Skip validation if no API key is set (development only)
        if (!validApiKey && process.env.NODE_ENV === 'development') {
            logger_1.logger.warn('No API key set, skipping authentication (development only)');
            return next();
        }
        // Get API key from request
        // Express normalizes header names to lowercase, so we check 'x-api-key'
        // This accepts any capitalization: X-API-Key, X-API-KEY, x-api-key, etc.
        const apiKey = req.headers['x-api-key'] || req.query.apiKey;
        // Validate API key
        if (!apiKey || apiKey !== validApiKey) {
            logger_1.logger.warn(`Invalid API key provided: ${apiKey}`);
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Invalid or missing API key'
            });
        }
        logger_1.logger.info('API key validated successfully');
        next();
    }
    catch (error) {
        logger_1.logger.error(`Error in auth middleware: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            error: 'Server error during authentication'
        });
    }
};
exports.apiKeyAuth = apiKeyAuth;
