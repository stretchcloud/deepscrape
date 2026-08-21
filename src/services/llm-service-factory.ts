import { OpenAIService } from './openai.service';
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
 * Factory class for creating LLM services.
 *
 * Talks to any OpenAI-compatible chat-completions endpoint. Set OPENAI_BASE_URL
 * to point at a local server (Ollama, vLLM, LM Studio, LiteLLM); leave it unset
 * for api.openai.com. When a base URL is set the API key becomes optional,
 * because most local servers ignore it entirely.
 */
export class LLMServiceFactory {
  /**
   * Create an OpenAI service instance
   */
  static createOpenAIService(taskComplexity?: TaskComplexity): OpenAIService | null {
    try {
      // Get configuration
      const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
      const organization = process.env.OPENAI_ORGANIZATION;
      const model = process.env.OPENAI_MODEL || 'gpt-4o'; // Default to gpt-4o

      // Local OpenAI-compatible servers generally ignore the key, but the SDK
      // requires a non-empty string, so supply a placeholder rather than making
      // the user invent one.
      const apiKey = process.env.OPENAI_API_KEY?.trim() || (baseURL ? 'not-needed' : undefined);

      if (!apiKey) {
        logger.warn(
          'LLM service not configured. Set OPENAI_API_KEY to use api.openai.com, ' +
          'or set OPENAI_BASE_URL to point at a local OpenAI-compatible server ' +
          '(for example http://localhost:11434/v1 for Ollama).'
        );
        return null;
      }

      logger.info(
        `Creating LLM service with model: ${model} via ${baseURL ?? 'api.openai.com'}`
      );

      return new OpenAIService({
        apiKey,
        organization,
        model,
        baseURL
      });
    } catch (error) {
      logger.error(`Error creating OpenAI service: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Create an LLM service
   * This is the main method to use for getting an LLM service instance
   */
  static createLLMService(taskComplexity?: TaskComplexity): OpenAIService | null {
    return this.createOpenAIService(taskComplexity);
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
