import { OpenAIService } from './openai.service';
import { LocalLLMService } from './local-llm.service';
import { LLMProvider, LLMProviderType, LLMConfig } from '../types/llm.types';
import { logger } from '../utils/logger';

/**
 * Task complexity types (kept for API compatibility)
 */
export enum TaskComplexity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * Factory class for creating LLM services
 * Always uses the OpenAI model specified in env variables
 */
export class LLMServiceFactory {
  /**
   * Get LLM provider from environment variables
   */
  private static getLLMProvider(): LLMProviderType {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    const validProviders: LLMProviderType[] = ['openai', 'vllm', 'ollama', 'localai', 'litellm', 'custom'];
    
    if (provider && validProviders.includes(provider as LLMProviderType)) {
      return provider as LLMProviderType;
    }
    
    // Default to OpenAI for backward compatibility
    return 'openai';
  }
  
  /**
   * Create an OpenAI service instance
   */
  static createOpenAIService(taskComplexity?: TaskComplexity): OpenAIService | null {
    try {
      // Get configuration
      const apiKey = process.env.OPENAI_API_KEY;
      const organization = process.env.OPENAI_ORGANIZATION;
      const model = process.env.OPENAI_MODEL ?? 'gpt-4o'; // Default to gpt-4o
      
      if (!apiKey) {
        logger.warn(
          'OpenAI service not configured correctly. Missing environment variable: OPENAI_API_KEY. ' +
          'Make sure to set this variable in your .env file.'
        );
        return null;
      }
      
      logger.info(`Creating OpenAI service with model: ${model}`);
      
      return new OpenAIService({
        apiKey,
        organization,
        model
      });
    } catch (error) {
      logger.error(`Error creating OpenAI service: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Create a local LLM service instance
   */
  static createLocalLLMService(provider: LLMProviderType): LLMProvider | null {
    try {
      // Get base configuration from environment
      const baseUrl = process.env.LLM_BASE_URL;
      const apiKey = process.env.LLM_API_KEY ?? 'dummy-key';
      const model = process.env.LLM_MODEL;
      const timeout = process.env.LLM_TIMEOUT ? parseInt(process.env.LLM_TIMEOUT) : undefined;
      const maxRetries = process.env.LLM_MAX_RETRIES ? parseInt(process.env.LLM_MAX_RETRIES) : undefined;
      
      // Provider-specific defaults for base URL
      const providerDefaults: Record<string, string> = {
        vllm: 'http://localhost:8000/v1',
        ollama: 'http://localhost:11434/v1',
        localai: 'http://localhost:8080/v1',
        litellm: 'http://localhost:4000',
        custom: 'http://localhost:8000/v1'
      };
      
      // Model defaults per provider
      const modelDefaults: Record<string, string> = {
        vllm: 'meta-llama/Llama-2-7b-chat-hf',
        ollama: 'llama2',
        localai: 'ggml-gpt4all-j',
        litellm: 'gpt-3.5-turbo',
        custom: 'local-model'
      };
      
      const finalBaseUrl = baseUrl ?? providerDefaults[provider];
      const finalModel = model ?? modelDefaults[provider];
      
      if (!finalBaseUrl) {
        logger.warn(
          `Local LLM service (${provider}) not configured correctly. Missing LLM_BASE_URL. ` +
          'Make sure to set this variable in your .env file.'
        );
        return null;
      }
      
      if (!finalModel) {
        logger.warn(
          `Local LLM service (${provider}) not configured correctly. Missing LLM_MODEL. ` +
          'Make sure to set this variable in your .env file.'
        );
        return null;
      }
      
      logger.info(`Creating ${provider} LLM service`, {
        baseUrl: finalBaseUrl,
        model: finalModel
      });
      
      const config: LLMConfig = {
        provider,
        baseUrl: finalBaseUrl,
        apiKey,
        model: finalModel,
        timeout,
        maxRetries
      };
      
      return new LocalLLMService(config);
    } catch (error) {
      logger.error(`Error creating ${provider} LLM service: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Create an LLM service
   * This is the main method to use for getting an LLM service instance
   */
  static createLLMService(taskComplexity?: TaskComplexity): LLMProvider | null {
    const provider = this.getLLMProvider();
    
    logger.info(`Creating LLM service with provider: ${provider}`);
    
    if (provider === 'openai') {
      return this.createOpenAIService(taskComplexity);
    } else {
      return this.createLocalLLMService(provider);
    }
  }
  
  /**
   * Determine the task complexity (kept for API compatibility)
   * This is ignored in model selection but maintained for interface compatibility
   */
  static getTaskComplexityForExtraction(options: { extractionType?: string; schema?: any }): TaskComplexity {
    // Always return MEDIUM complexity as it doesn't matter anymore
    return TaskComplexity.MEDIUM;
  }
} 