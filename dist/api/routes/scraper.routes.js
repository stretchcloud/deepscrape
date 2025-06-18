"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const scraper_controller_1 = require("../controllers/scraper.controller");
const html_to_markdown_1 = require("../../transformers/html-to-markdown");
const content_cleaner_1 = require("../../transformers/content-cleaner");
const logger_1 = require("../../utils/logger");
const router = (0, express_1.Router)();
/**
 * @route POST /api/scrape
 * @description Scrape a URL and return the content
 * @access Public
 */
router.post('/scrape', scraper_controller_1.scrapeUrl);
/**
 * @route POST /api/debug/transform
 * @description Debug route for HTML to Markdown transformation
 * @access Public
 */
router.post('/debug/transform', async (req, res) => {
    try {
        const { html } = req.body;
        if (!html) {
            return res.status(400).json({
                success: false,
                error: 'HTML content is required'
            });
        }
        logger_1.logger.info('Debug route: Testing HTML to Markdown transformation');
        // Create transformer instances
        const contentCleaner = new content_cleaner_1.ContentCleaner();
        const markdownTransformer = new html_to_markdown_1.HtmlToMarkdownTransformer();
        // Clean the HTML first
        const cleanedResponse = contentCleaner.clean({
            url: 'http://debug.example.com',
            title: 'Debug Page',
            content: html,
            contentType: 'html',
            metadata: {
                timestamp: new Date().toISOString(),
                status: 200,
                headers: {},
                processingTime: 0
            }
        });
        // Transform to markdown
        const markdownResponse = markdownTransformer.transform(cleanedResponse);
        return res.status(200).json({
            success: true,
            originalHtmlLength: html.length,
            cleanedHtmlLength: cleanedResponse.content.length,
            markdownLength: markdownResponse.content.length,
            contentType: markdownResponse.contentType,
            markdown: markdownResponse.content,
            error: markdownResponse.error || null
        });
    }
    catch (error) {
        logger_1.logger.error(`Debug transformation error: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            error: `Transformation error: ${error instanceof Error ? error.message : String(error)}`
        });
    }
});
exports.default = router;
