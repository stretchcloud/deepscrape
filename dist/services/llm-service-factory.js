"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMServiceFactory = exports.TaskComplexity = void 0;
const openai_service_1 = require("./openai.service");
const logger_1 = require("../utils/logger");
/**
 * Task complexity types (kept for API compatibility)
 */
var TaskComplexity;
(function (TaskComplexity) {
    TaskComplexity["LOW"] = "low";
    TaskComplexity["MEDIUM"] = "medium";
    TaskComplexity["HIGH"] = "high";
})(TaskComplexity || (exports.TaskComplexity = TaskComplexity = {}));
/**
 * Factory class for creating LLM services
 * Always uses the OpenAI model specified in env variables
 */
class LLMServiceFactory {
    /**
     * Create an OpenAI service instance
     */
    static createOpenAIService(taskComplexity) {
        try {
            // Get configuration
            const apiKey = process.env.OPENAI_API_KEY;
            const organization = process.env.OPENAI_ORGANIZATION;
            const model = process.env.OPENAI_MODEL || 'gpt-4o'; // Default to gpt-4o
            if (!apiKey) {
                logger_1.logger.warn('OpenAI service not configured correctly. Missing environment variable: OPENAI_API_KEY. ' +
                    'Make sure to set this variable in your .env file.');
                return null;
            }
            logger_1.logger.info(`Creating OpenAI service with model: ${model}`);
            return new openai_service_1.OpenAIService({
                apiKey,
                organization,
                model
            });
        }
        catch (error) {
            logger_1.logger.error(`Error creating OpenAI service: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    /**
     * Create an LLM service
     * This is the main method to use for getting an LLM service instance
     */
    static createLLMService(taskComplexity) {
        return this.createOpenAIService(taskComplexity);
    }
    /**
     * Determine the task complexity (kept for API compatibility)
     * This is ignored in model selection but maintained for interface compatibility
     */
    static getTaskComplexityForExtraction(options) {
        // Always return MEDIUM complexity as it doesn't matter anymore
        return TaskComplexity.MEDIUM;
    }
}
exports.LLMServiceFactory = LLMServiceFactory;
