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
 * Factory class for creating LLM services
 * Always uses the OpenAI model specified in env variables
 */
export class LLMServiceFactory {
  /**
   * Create an OpenAI service instance
   */
  static createOpenAIService(taskComplexity?: TaskComplexity): OpenAIService | null {
    try {
      // Get configuration
      const apiKey = process.env.OPENAI_API_KEY;
      const organization = process.env.OPENAI_ORGANIZATION;
      const model = process.env.OPENAI_MODEL || 'gpt-4o'; // Default to gpt-4o
      
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