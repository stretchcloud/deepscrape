"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const scraper_manager_1 = __importDefault(require("../../scraper/scraper-manager"));
const logger_1 = require("../../utils/logger");
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_1 = require("../middleware/validation");
const router = (0, express_1.Router)();
// Browser action schema
const browserActionSchema = zod_1.z.object({
    type: zod_1.z.enum(['click', 'scroll', 'wait', 'fill', 'select']),
    selector: zod_1.z.string().optional(),
    value: zod_1.z.string().optional(),
    position: zod_1.z.number().optional(),
    timeout: zod_1.z.number().optional(),
    optional: zod_1.z.boolean().optional()
});
/**
 * @route POST /api/scrape
 * @desc Scrape a URL and return the content
 * @access Private (requires API key authentication)
 */
router.post('/scrape', auth_middleware_1.apiKeyAuth, (0, validation_1.validateRequest)(zod_1.z.object({
    url: zod_1.z.string().url(),
    options: zod_1.z.object({
        waitForSelector: zod_1.z.string().optional(),
        waitForTimeout: zod_1.z.number().int().positive().optional(),
        actions: zod_1.z.array(browserActionSchema).optional(),
        skipCache: zod_1.z.boolean().optional(),
        cacheTtl: zod_1.z.number().int().positive().optional(),
        extractorFormat: zod_1.z.enum(['html', 'markdown', 'text']).optional(),
    }).optional()
})), async (req, res) => {
    try {
        const { url, options = {} } = req.body;
        logger_1.logger.info(`API request received to scrape URL: ${url}`);
        const startTime = Date.now();
        const response = await scraper_manager_1.default.scrape(url, options);
        const processingTime = Date.now() - startTime;
        if (response.error) {
            logger_1.logger.error(`Error scraping URL ${url}: ${response.error}`);
            return res.status(400).json({
                success: false,
                error: response.error,
                url,
                metadata: {
                    processingTime,
                    fromCache: response.metadata?.fromCache ?? false
                }
            });
        }
        return res.json({
            success: true,
            url: response.url,
            title: response.title ?? "",
            content: response.content,
            contentType: response.contentType,
            metadata: {
                ...response.metadata,
                processingTime
            }
        });
    }
    catch (error) {
        logger_1.logger.error(`Unexpected error in scrape route: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * @route POST /api/extract-schema
 * @desc Extract structured data from a URL using a schema
 * @access Private (requires API key authentication)
 */
router.post('/extract-schema', auth_middleware_1.apiKeyAuth, (0, validation_1.validateRequest)(zod_1.z.object({
    url: zod_1.z.string().url(),
    schema: zod_1.z.object({}).passthrough(), // Allow any schema object
    options: zod_1.z.object({
        waitForSelector: zod_1.z.string().optional(),
        waitForTimeout: zod_1.z.number().int().positive().optional(),
        actions: zod_1.z.array(browserActionSchema).optional(),
        skipCache: zod_1.z.boolean().optional(),
        cacheTtl: zod_1.z.number().int().positive().optional(),
        extractorFormat: zod_1.z.enum(['html', 'markdown', 'text']).optional(),
        temperature: zod_1.z.number().min(0).max(2).optional(),
        maxTokens: zod_1.z.number().int().positive().optional(),
        instructions: zod_1.z.string().optional()
    }).optional()
})), async (req, res) => {
    try {
        const { url, schema, options = {} } = req.body;
        logger_1.logger.info(`API request received to extract structured data from URL: ${url}`);
        const startTime = Date.now();
        // Combine options with extraction options and force markdown format
        const scrapingOptions = {
            ...options,
            extractorFormat: options.extractorFormat ?? 'markdown', // Default to markdown
            extractionOptions: {
                schema,
                instructions: options.instructions,
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                extractionType: 'structured'
            }
        };
        const response = await scraper_manager_1.default.scrape(url, scrapingOptions);
        const processingTime = Date.now() - startTime;
        if (response.error) {
            logger_1.logger.error(`Error extracting schema from URL ${url}: ${response.error}`);
            return res.status(400).json({
                success: false,
                error: response.error,
                url,
                metadata: {
                    processingTime,
                    fromCache: response.metadata?.fromCache ?? false
                }
            });
        }
        // Cast response to access extended properties
        const extendedResponse = response;
        // If LLM extraction was not available, create a formatted response
        let formattedResponse = {};
        // Check for structured data from the API result
        if (extendedResponse.structuredData) {
            // Use the structured data directly from the LLM extraction result
            formattedResponse = extendedResponse.structuredData;
            logger_1.logger.info('Using structured data from successful LLM extraction');
        }
        else if (extendedResponse.extractedData) {
            // Use extractedData if structuredData isn't available
            formattedResponse = extendedResponse.extractedData;
            logger_1.logger.info('Using extractedData from response');
        }
        else if (extendedResponse.content) {
            // Fallback to basic data if no extraction was performed
            formattedResponse = {
                url: extendedResponse.url,
                title: extendedResponse.title ?? "No title available",
                contentPreview: extendedResponse.content.substring(0, 500) + "..."
            };
            logger_1.logger.warn('No structured data available, using basic content preview');
        }
        // Format the response with proper markdown
        const markdownContent = formatResponseAsMarkdown(extendedResponse.url, extendedResponse.title, schema, formattedResponse, null // No warning message
        );
        // If format is markdown, return the formatted markdown directly as extractedData
        const responseData = options.extractorFormat === 'markdown'
            ? markdownContent
            : formattedResponse;
        return res.json({
            success: true,
            url: extendedResponse.url,
            title: extendedResponse.title,
            extractedData: responseData,
            contentType: 'markdown', // Specify content type as markdown
            metadata: {
                ...extendedResponse.metadata,
                processingTime
            }
            // No warning message
        });
    }
    catch (error) {
        logger_1.logger.error(`Unexpected error in schema extraction route: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * Format a header section with title and URL
 */
function formatMarkdownHeader(url, title, warningMessage) {
    let markdown = `# ${title ?? 'Extracted Content'}\n\n`;
    markdown += `URL: ${url}\n\n`;
    if (warningMessage) {
        markdown += `> ⚠️ **Note**: ${warningMessage}\n\n`;
    }
    return markdown;
}
/**
 * Format code examples as markdown code blocks
 */
function formatCodeExamples(value) {
    let markdown = '';
    value.forEach((item, index) => {
        markdown += `#### Example ${index + 1}\n\n`;
        markdown += '```typescript\n' + item + '\n```\n\n';
    });
    return markdown;
}
/**
 * Format array of objects as nested markdown structure
 */
function formatObjectArray(value) {
    let markdown = '';
    value.forEach((item, index) => {
        markdown += `#### Item ${index + 1}\n\n`;
        for (const [objKey, objValue] of Object.entries(item)) {
            markdown += `**${objKey.charAt(0).toUpperCase() + objKey.slice(1)}**:\n`;
            if (Array.isArray(objValue)) {
                objValue.forEach(v => markdown += `- ${v}\n`);
            }
            else {
                markdown += `${objValue}\n`;
            }
            markdown += '\n';
        }
    });
    return markdown;
}
/**
 * Format simple array as bullet list
 */
function formatSimpleArray(value) {
    let markdown = '';
    value.forEach(item => {
        markdown += `- ${item}\n`;
    });
    return markdown + '\n';
}
/**
 * Format a single field value based on its type
 */
function formatFieldValue(key, value) {
    if (value === null || value === undefined) {
        return '*No data available*\n\n';
    }
    if (Array.isArray(value)) {
        const isCodeField = key.toLowerCase().includes('code') || key.toLowerCase().includes('example');
        if (isCodeField) {
            return formatCodeExamples(value);
        }
        if (value.length > 0 && typeof value[0] === 'object') {
            return formatObjectArray(value);
        }
        return formatSimpleArray(value);
    }
    if (typeof value === 'object') {
        return '```json\n' + JSON.stringify(value, null, 2) + '\n```\n\n';
    }
    return `${value}\n\n`;
}
/**
 * Format extracted data as Markdown
 */
function formatResponseAsMarkdown(url, title, schema, extractedData, warningMessage) {
    let markdown = formatMarkdownHeader(url, title, warningMessage);
    markdown += `## Extracted Data\n\n`;
    if (Object.keys(extractedData).length > 0) {
        for (const [key, value] of Object.entries(extractedData)) {
            markdown += `### ${key.charAt(0).toUpperCase() + key.slice(1)}\n\n`;
            markdown += formatFieldValue(key, value);
        }
    }
    else {
        markdown += "*No data could be extracted. Try enabling LLM extraction with OpenAI credentials.*\n\n";
    }
    return markdown;
}
/**
 * @route POST /api/summarize
 * @desc Summarize the content of a URL
 * @access Private (requires API key authentication)
 */
router.post('/summarize', auth_middleware_1.apiKeyAuth, (0, validation_1.validateRequest)(zod_1.z.object({
    url: zod_1.z.string().url(),
    maxLength: zod_1.z.number().int().positive().optional(), // Maximum length of summary in words
    options: zod_1.z.object({
        waitForSelector: zod_1.z.string().optional(),
        waitForTimeout: zod_1.z.number().int().positive().optional(),
        actions: zod_1.z.array(browserActionSchema).optional(),
        skipCache: zod_1.z.boolean().optional(),
        cacheTtl: zod_1.z.number().int().positive().optional(),
        extractorFormat: zod_1.z.enum(['html', 'markdown', 'text']).optional(),
        temperature: zod_1.z.number().min(0).max(2).optional(),
    }).optional()
})), async (req, res) => {
    try {
        const { url, maxLength = 500, options = {} } = req.body;
        logger_1.logger.info(`API request received to summarize URL: ${url}`);
        const startTime = Date.now();
        // Create summary extraction options
        const scrapingOptions = {
            ...options,
            extractorFormat: options.extractorFormat || 'markdown',
            extractionOptions: {
                instructions: `Provide a concise summary of the content in about ${maxLength} words.
            Focus on the main points and key information.`,
                temperature: options.temperature ?? 0.3,
                maxTokens: maxLength * 2, // Approximation for token limit
                extractionType: 'summarize'
            }
        };
        const response = await scraper_manager_1.default.scrape(url, scrapingOptions);
        const processingTime = Date.now() - startTime;
        if (response.error) {
            logger_1.logger.error(`Error summarizing URL ${url}: ${response.error}`);
            return res.status(400).json({
                success: false,
                error: response.error,
                url,
                metadata: {
                    processingTime,
                    fromCache: response.metadata?.fromCache ?? false
                }
            });
        }
        // Cast response to access extended properties
        const extendedResponse = response;
        // Log response details for debugging
        logger_1.logger.info(`Response data fields: ${Object.keys(response).join(', ')}`);
        logger_1.logger.info(`Response structuredData: ${extendedResponse.structuredData ? 'present' : 'missing'}`);
        logger_1.logger.info(`Response extractedData: ${extendedResponse.extractedData ? 'present' : 'missing'}`);
        // Choose the best available data field for summary
        let summaryContent = null;
        if (extendedResponse.structuredData?.summary) {
            summaryContent = extendedResponse.structuredData.summary;
            logger_1.logger.info('Using structuredData.summary');
        }
        else if (extendedResponse.structuredData) {
            summaryContent = extendedResponse.structuredData;
            logger_1.logger.info('Using structuredData');
        }
        else if (extendedResponse.extractedData?.summary) {
            summaryContent = extendedResponse.extractedData.summary;
            logger_1.logger.info('Using extractedData.summary');
        }
        else if (extendedResponse.extractedData) {
            summaryContent = extendedResponse.extractedData;
            logger_1.logger.info('Using extractedData');
        }
        else if (extendedResponse.content) {
            // Generate a simple fallback summary from content
            const contentPreview = extendedResponse.content.substring(0, 500);
            summaryContent = `${extendedResponse.title}\n\n${contentPreview}...`;
            logger_1.logger.warn('No structured summary available, using content preview');
        }
        return res.json({
            success: true,
            url: extendedResponse.url,
            title: extendedResponse.title,
            summary: summaryContent,
            metadata: {
                ...extendedResponse.metadata,
                processingTime
            }
        });
    }
    catch (error) {
        logger_1.logger.error(`Unexpected error in summarize route: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * @route DELETE /api/cache
 * @desc Clear the entire cache or invalidate a specific URL
 * @access Private (requires API key authentication)
 */
router.delete('/cache', auth_middleware_1.apiKeyAuth, (0, validation_1.validateRequest)(zod_1.z.object({
    url: zod_1.z.string().optional() // If provided, invalidate only this URL
})), async (req, res) => {
    try {
        const { url } = req.body;
        if (url) {
            logger_1.logger.info(`API request received to invalidate cache for URL: ${url}`);
            await scraper_manager_1.default.invalidateCache(url);
            return res.json({
                success: true,
                message: `Cache invalidated for URL: ${url}`
            });
        }
        else {
            logger_1.logger.info('API request received to clear entire cache');
            await scraper_manager_1.default.clearCache();
            return res.json({
                success: true,
                message: 'Cache cleared'
            });
        }
    }
    catch (error) {
        logger_1.logger.error(`Unexpected error in cache route: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
exports.default = router;
