"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeUrl = void 0;
const zod_1 = require("zod");
const scraper_manager_1 = require("../../scraper/scraper-manager");
const logger_1 = require("../../utils/logger");
// Initialize scraper manager
const scraperManager = new scraper_manager_1.ScraperManager();
// Validation schema for scrape request
const scrapeRequestSchema = zod_1.z.object({
    url: zod_1.z.string().url().nonempty(),
    options: zod_1.z.object({
        timeout: zod_1.z.number().positive().optional(),
        blockAds: zod_1.z.boolean().optional(),
        blockResources: zod_1.z.boolean().optional(),
        userAgent: zod_1.z.string().optional(),
        proxy: zod_1.z.string().optional(),
        cookies: zod_1.z.record(zod_1.z.string()).optional(),
        headers: zod_1.z.record(zod_1.z.string()).optional(),
        waitForSelector: zod_1.z.string().optional(),
        fullPage: zod_1.z.boolean().optional(),
        javascript: zod_1.z.boolean().optional(),
        extractorFormat: zod_1.z.enum(['html', 'markdown', 'text']).optional(),
    }).optional(),
}).strict();
/**
 * Handle scrape request
 */
const scrapeUrl = async (req, res) => {
    try {
        logger_1.logger.info(`Received scrape request: ${JSON.stringify(req.body)}`);
        // Validate request body
        const validationResult = scrapeRequestSchema.safeParse(req.body);
        if (!validationResult.success) {
            logger_1.logger.warn(`Validation error: ${JSON.stringify(validationResult.error)}`);
            const response = {
                success: false,
                error: 'Validation error: ' + JSON.stringify(validationResult.error.errors)
            };
            return res.status(400).json(response);
        }
        const { url, options = {} } = validationResult.data;
        // Process the request synchronously
        logger_1.logger.info(`Processing scrape request for URL: ${url}`);
        const result = await scraperManager.scrape(url, options);
        // Check if there was an error during scraping
        if (result.error) {
            logger_1.logger.error(`Error scraping URL ${url}: ${result.error}`);
            const response = {
                success: false,
                error: result.error
            };
            return res.status(500).json(response);
        }
        // Send successful response
        const response = {
            success: true,
            data: result
        };
        logger_1.logger.info(`Successfully processed scrape request for URL: ${url}`);
        return res.status(200).json(response);
    }
    catch (error) {
        logger_1.logger.error(`Unexpected error processing scrape request: ${error instanceof Error ? error.message : String(error)}`);
        const response = {
            success: false,
            error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
        };
        return res.status(500).json(response);
    }
};
exports.scrapeUrl = scrapeUrl;
