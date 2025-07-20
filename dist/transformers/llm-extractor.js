"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMExtractor = void 0;
const logger_1 = require("../utils/logger");
/**
 * Limit token size to prevent exceeding model limits
 * @param text The text to limit
 * @param maxTokens Maximum number of tokens
 */
function limitTextSize(text, maxTokens = 15000) {
    // Simple approximation: 1 token ≈ 4 characters for English text
    const maxCharacters = maxTokens * 4;
    if (text.length <= maxCharacters) {
        return text;
    }
    // If text is too long, cut it and add a note
    return text.substring(0, maxCharacters) +
        "\n\n[Note: Content was truncated due to length limitations.]";
}
class LLMExtractor {
    constructor(llmService) {
        this.llmService = llmService;
    }
    /**
     * Extract structured data using LLM
     */
    async extract(scraperResponse, options) {
        try {
            const startTime = Date.now();
            logger_1.logger.info(`Starting LLM extraction for URL: ${scraperResponse.url}`);
            // Get content to analyze
            const content = scraperResponse.content;
            if (!content) {
                logger_1.logger.warn('Content is empty, skipping extraction');
                return {
                    ...scraperResponse,
                    extractionResult: {
                        success: false,
                        error: 'Content is empty'
                    }
                };
            }
            // Limit content size to prevent token limit issues
            const limitedContent = limitTextSize(content, 15000);
            // Format extraction prompt based on extraction type
            const messages = this.createExtractionPrompt(limitedContent, scraperResponse.title, scraperResponse.url, options);
            // Configure response format as JSON if a schema is provided
            const responseFormat = options.schema
                ? { type: 'json_object' }
                : undefined;
            // Make the LLM API call
            const llmResponse = await this.llmService.getCompletion(messages, {
                temperature: options.temperature || 0.2,
                maxTokens: options.maxTokens || 4000
            }, responseFormat);
            const extractionTime = Date.now() - startTime;
            if (!llmResponse.success) {
                logger_1.logger.error(`LLM extraction failed: ${llmResponse.error}`);
                return {
                    ...scraperResponse,
                    extractionResult: {
                        success: false,
                        error: llmResponse.error,
                        metadata: {
                            extractionTime
                        }
                    }
                };
            }
            // Add the structured data to the response
            logger_1.logger.info(`LLM extraction completed successfully in ${extractionTime}ms`);
            return {
                ...scraperResponse,
                structuredData: llmResponse.data,
                extractionResult: {
                    success: true,
                    data: llmResponse.data,
                    metadata: {
                        extractionTime,
                        modelName: this.llmService.getModel() || 'gpt-4o'
                    }
                }
            };
        }
        catch (error) {
            logger_1.logger.error(`Error during LLM extraction: ${error instanceof Error ? error.message : String(error)}`);
            return {
                ...scraperResponse,
                extractionResult: {
                    success: false,
                    error: `LLM extraction error: ${error instanceof Error ? error.message : String(error)}`
                }
            };
        }
    }
    /**
     * Create an extraction prompt based on options
     */
    createExtractionPrompt(content, title, url, options) {
        const { schema, instructions, extractionType = 'structured', promptFormat = 'zero-shot' } = options;
        const messages = [];
        // System message defines the task
        let systemMessage = 'You are an expert web content analyzer and data extractor. ';
        if (extractionType === 'structured' && schema) {
            systemMessage += 'Extract structured data from the content based on the provided schema and output as JSON. ';
            systemMessage += 'Be precise and follow the schema exactly. If information is not available, use null or empty values.';
        }
        else if (extractionType === 'summary') {
            systemMessage += 'You are a professional content summarizer. Create a concise summary of the main points in the provided content. ';
            systemMessage += 'CRITICAL: Output ONLY the final summary. Do NOT include: ';
            systemMessage += '1) Your reasoning process or thoughts about what the user wants. ';
            systemMessage += '2) Meta-commentary like "The user wants me to..." or "I need to..." or "Let me...". ';
            systemMessage += '3) Any explanation of your approach or methodology. ';
            systemMessage += '4) Any XML tags or markdown formatting for thinking. ';
            systemMessage += 'Start directly with the summary content itself.';
        }
        else if (extractionType === 'qa') {
            systemMessage += 'Answer questions about the provided content accurately and concisely.';
        }
        messages.push({ role: 'system', content: systemMessage });
        // If few-shot prompting is used and example data is provided
        if (promptFormat === 'few-shot' && options.exampleData) {
            messages.push({
                role: 'user',
                content: 'Here is an example of the extraction format I want:\n' +
                    JSON.stringify(options.exampleData, null, 2)
            });
            messages.push({
                role: 'assistant',
                content: 'I understand. I will extract information in that format.'
            });
        }
        // Construct the main user message with the content
        let userMessage = `I need to extract information from the following web content from ${url}`;
        if (title) {
            userMessage += ` with title "${title}"`;
        }
        // Add JSON reference for schema extractions
        if (schema) {
            userMessage += ' and return it as JSON';
        }
        userMessage += ':\n\n';
        userMessage += content;
        // Add schema details if available
        if (schema) {
            userMessage += '\n\nPlease extract information using this JSON schema:\n';
            userMessage += JSON.stringify(schema, null, 2);
        }
        // Add custom instructions if provided
        if (instructions) {
            userMessage += `\n\nAdditional instructions: ${instructions}`;
            // Ensure JSON is mentioned in the instructions if using a schema
            if (schema && !instructions.toLowerCase().includes('json')) {
                userMessage += ' and format as JSON';
            }
        }
        else if (schema) {
            // If no instructions provided but using schema, add a default JSON instruction
            userMessage += '\n\nAdditional instructions: Extract the information and format as JSON';
        }
        messages.push({ role: 'user', content: userMessage });
        return messages;
    }
}
exports.LLMExtractor = LLMExtractor;
