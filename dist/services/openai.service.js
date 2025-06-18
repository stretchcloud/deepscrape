"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIService = void 0;
const openai_1 = __importDefault(require("openai"));
const logger_1 = require("../utils/logger");
class OpenAIService {
    constructor(config) {
        this.client = new openai_1.default({
            apiKey: config.apiKey,
            organization: config.organization
        });
        this._model = config.model;
    }
    /**
     * Get the model name
     */
    get model() {
        return this._model;
    }
    /**
     * Get completion from OpenAI
     */
    async getCompletion(messages, options = {}, responseFormat) {
        try {
            const { temperature = 0.2, maxTokens = 4000 } = options;
            logger_1.logger.info(`Sending request to OpenAI: ${this._model}`);
            // Convert messages to the type expected by OpenAI
            const typedMessages = messages.map(msg => {
                // Only include role and content for simplicity
                if (msg.role === 'system') {
                    return { role: 'system', content: msg.content };
                }
                else if (msg.role === 'user') {
                    return { role: 'user', content: msg.content };
                }
                else if (msg.role === 'assistant') {
                    return { role: 'assistant', content: msg.content };
                }
                else if (msg.role === 'function') {
                    // Function messages require a name, but we don't have it in our simple interface
                    // This is a fallback that should rarely be used
                    return { role: 'user', content: msg.content };
                }
                else if (msg.role === 'tool') {
                    // Tool messages also require additional fields
                    // This is a fallback that should rarely be used
                    return { role: 'user', content: msg.content };
                }
                else {
                    // Default to user if role is unknown
                    return { role: 'user', content: msg.content };
                }
            });
            const response = await this.client.chat.completions.create({
                model: this._model,
                messages: typedMessages,
                temperature,
                max_tokens: maxTokens,
                response_format: responseFormat
            });
            // Process the response
            const content = response.choices[0].message.content;
            try {
                // If response is JSON string, parse it
                const parsedContent = typeof content === 'string' && content.trim().startsWith('{')
                    ? JSON.parse(content)
                    : content;
                return {
                    success: true,
                    data: parsedContent
                };
            }
            catch (parseError) {
                // If parsing fails, return the raw content
                return {
                    success: true,
                    data: content
                };
            }
        }
        catch (error) {
            logger_1.logger.error(`Error calling OpenAI: ${error instanceof Error ? error.message : String(error)}`);
            return {
                success: false,
                error: `OpenAI service error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Get embeddings from OpenAI
     */
    async getEmbeddings(text) {
        try {
            const inputArray = Array.isArray(text) ? text : [text];
            logger_1.logger.info(`Getting embeddings from OpenAI: ${this._model}`);
            const response = await this.client.embeddings.create({
                model: 'text-embedding-3-small', // Use the appropriate embedding model
                input: inputArray
            });
            const embeddings = response.data.map(item => item.embedding);
            return {
                success: true,
                data: embeddings
            };
        }
        catch (error) {
            logger_1.logger.error(`Error getting embeddings: ${error instanceof Error ? error.message : String(error)}`);
            return {
                success: false,
                error: `OpenAI embeddings error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}
exports.OpenAIService = OpenAIService;
