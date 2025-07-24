import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { 
  LLMProvider, 
  LLMResponse, 
  LLMMessage, 
  LLMCompletionOptions,
  LLMProviderType 
} from '../types/llm.types';
import { logger } from '../utils/logger';

interface OpenAIConfig {
  apiKey: string;
  organization?: string;
  model: string;
}


export class OpenAIService implements LLMProvider {
  private readonly client: OpenAI;
  private readonly _model: string;

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization
    });
    this._model = config.model;
  }
  
  /**
   * Get the model name
   */
  get model(): string {
    return this._model;
  }
  
  /**
   * Get the provider type
   */
  getProvider(): LLMProviderType {
    return 'openai';
  }
  
  /**
   * Get the current model
   */
  getModel(): string {
    return this._model;
  }

  /**
   * Get completion from OpenAI
   */
  async getCompletion<T>(
    messages: LLMMessage[], 
    options: LLMCompletionOptions = {},
    responseFormat?: { type: string; schema?: object }
  ): Promise<LLMResponse<T>> {
    try {
      const { 
        temperature = 0.2, 
        maxTokens = 4000,
        topP,
        frequencyPenalty,
        presencePenalty,
        stop,
        seed,
        user
      } = options;

      logger.info(`Sending request to OpenAI: ${this._model}`);
      
      // Convert messages to the type expected by OpenAI
      const typedMessages: ChatCompletionMessageParam[] = messages.map(msg => {
        // Only include role and content for simplicity
        if (msg.role === 'system') {
          return { role: 'system', content: msg.content };
        } else if (msg.role === 'user') {
          return { role: 'user', content: msg.content };
        } else if (msg.role === 'assistant') {
          return { role: 'assistant', content: msg.content };
        } else if (msg.role === 'function') {
          // Function messages require a name, but we don't have it in our simple interface
          // This is a fallback that should rarely be used
          return { role: 'user', content: msg.content };
        } else if (msg.role === 'tool') {
          // Tool messages also require additional fields
          // This is a fallback that should rarely be used
          return { role: 'user', content: msg.content };
        } else {
          // Default to user if role is unknown
          return { role: 'user', content: msg.content };
        }
      });
      
      const response = await this.client.chat.completions.create({
        model: this._model,
        messages: typedMessages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        stop,
        seed,
        user,
        response_format: responseFormat as any
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
          data: parsedContent as T,
          metadata: {
            model: response.model,
            provider: 'openai',
            usage: response.usage ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens
            } : undefined
          }
        };
      } catch (parseError) {
        // If parsing fails, return the raw content
        logger.warn(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        return {
          success: true,
          data: content as unknown as T,
          metadata: {
            model: response.model,
            provider: 'openai',
            usage: response.usage ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens
            } : undefined
          }
        };
      }
    } catch (error) {
      logger.error(`Error calling OpenAI: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        error: `OpenAI service error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get embeddings from OpenAI
   */
  async getEmbeddings(text: string | string[]): Promise<LLMResponse<number[][]>> {
    try {
      const inputArray = Array.isArray(text) ? text : [text];
      
      logger.info(`Getting embeddings from OpenAI: ${this._model}`);
      
      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small', // Use the appropriate embedding model
        input: inputArray
      });
      
      const embeddings = response.data.map(item => item.embedding);
      
      return {
        success: true,
        data: embeddings,
        metadata: {
          model: 'text-embedding-3-small',
          provider: 'openai',
          usage: response.usage ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: 0,
            totalTokens: response.usage.total_tokens
          } : undefined
        }
      };
    } catch (error) {
      logger.error(`Error getting embeddings: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        error: `OpenAI embeddings error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
} 