"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleValidationErrors = exports.validateRequest = void 0;
const express_validator_1 = require("express-validator");
const logger_1 = require("../../utils/logger");
/**
 * Middleware to validate requests using Zod schemas
 */
const validateRequest = (schema) => {
    return (req, res, next) => {
        try {
            // Validate request body against schema
            const result = schema.safeParse(req.body);
            if (!result.success) {
                logger_1.logger.warn(`Request validation failed: ${JSON.stringify(result.error)}`);
                return res.status(400).json({
                    success: false,
                    error: 'Validation error',
                    details: result.error.errors
                });
            }
            // Validation successful, continue
            req.body = result.data;
            next();
        }
        catch (error) {
            logger_1.logger.error(`Error in validation middleware: ${error instanceof Error ? error.message : String(error)}`);
            return res.status(500).json({
                success: false,
                error: 'Server error during validation'
            });
        }
    };
};
exports.validateRequest = validateRequest;
/**
 * Middleware to handle express-validator validation results
 */
const handleValidationErrors = (req, res, next) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            logger_1.logger.warn(`Express-validator validation failed: ${JSON.stringify(errors.array())}`);
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors.array()
            });
        }
        // Validation successful, continue
        next();
    }
    catch (error) {
        logger_1.logger.error(`Error in express-validator middleware: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            error: 'Server error during validation'
        });
    }
};
exports.handleValidationErrors = handleValidationErrors;
