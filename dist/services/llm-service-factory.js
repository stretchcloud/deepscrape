"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMServiceFactory = exports.TaskComplexity = void 0;
const openai_service_1 = require("./openai.service");
const local_llm_service_1 = require("./local-llm.service");
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
     * Get LLM provider from environment variables
     */
    static getLLMProvider() {
        const provider = process.env.LLM_PROVIDER?.toLowerCase();
        const validProviders = ['openai', 'vllm', 'ollama', 'localai', 'litellm', 'custom'];
        if (provider && validProviders.includes(provider)) {
            return provider;
        }
        // Default to OpenAI for backward compatibility
        return 'openai';
    }
    /**
     * Create an OpenAI service instance
     */
    static createOpenAIService(taskComplexity) {
        try {
            // Get configuration
            const apiKey = process.env.OPENAI_API_KEY;
            const organization = process.env.OPENAI_ORGANIZATION;
            const model = process.env.OPENAI_MODEL ?? 'gpt-4o'; // Default to gpt-4o
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
     * Create a local LLM service instance
     */
    static createLocalLLMService(provider) {
        try {
            // Get base configuration from environment
            const baseUrl = process.env.LLM_BASE_URL;
            const apiKey = process.env.LLM_API_KEY ?? 'dummy-key';
            const model = process.env.LLM_MODEL;
            const timeout = process.env.LLM_TIMEOUT ? parseInt(process.env.LLM_TIMEOUT) : undefined;
            const maxRetries = process.env.LLM_MAX_RETRIES ? parseInt(process.env.LLM_MAX_RETRIES) : undefined;
            // Provider-specific defaults for base URL
            const providerDefaults = {
                vllm: 'http://localhost:8000/v1',
                ollama: 'http://localhost:11434/v1',
                localai: 'http://localhost:8080/v1',
                litellm: 'http://localhost:4000',
                custom: 'http://localhost:8000/v1'
            };
            // Model defaults per provider
            const modelDefaults = {
                vllm: 'meta-llama/Llama-2-7b-chat-hf',
                ollama: 'llama2',
                localai: 'ggml-gpt4all-j',
                litellm: 'gpt-3.5-turbo',
                custom: 'local-model'
            };
            const finalBaseUrl = baseUrl ?? providerDefaults[provider];
            const finalModel = model ?? modelDefaults[provider];
            if (!finalBaseUrl) {
                logger_1.logger.warn(`Local LLM service (${provider}) not configured correctly. Missing LLM_BASE_URL. ` +
                    'Make sure to set this variable in your .env file.');
                return null;
            }
            if (!finalModel) {
                logger_1.logger.warn(`Local LLM service (${provider}) not configured correctly. Missing LLM_MODEL. ` +
                    'Make sure to set this variable in your .env file.');
                return null;
            }
            logger_1.logger.info(`Creating ${provider} LLM service`, {
                baseUrl: finalBaseUrl,
                model: finalModel
            });
            const config = {
                provider,
                baseUrl: finalBaseUrl,
                apiKey,
                model: finalModel,
                timeout,
                maxRetries
            };
            return new local_llm_service_1.LocalLLMService(config);
        }
        catch (error) {
            logger_1.logger.error(`Error creating ${provider} LLM service: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    /**
     * Create an LLM service
     * This is the main method to use for getting an LLM service instance
     */
    static createLLMService(taskComplexity) {
        const provider = this.getLLMProvider();
        logger_1.logger.info(`Creating LLM service with provider: ${provider}`);
        if (provider === 'openai') {
            return this.createOpenAIService(taskComplexity);
        }
        else {
            return this.createLocalLLMService(provider);
        }
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
