/**
 * Types for LLM provider configuration and responses
 */

/**
 * Supported LLM provider types
 */
export type LLMProviderType = 'openai' | 'vllm' | 'ollama' | 'localai' | 'litellm' | 'custom';

/**
 * Configuration for LLM providers
 */
export interface LLMConfig {
  provider: LLMProviderType;
  baseUrl?: string;
  apiKey: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
  organizationId?: string;
}

/**
 * Options for LLM completion requests
 */
export interface LLMCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  seed?: number;
  user?: string;
}

/**
 * Response from LLM providers
 */
export interface LLMResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    model?: string;
    provider?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    latency?: number;
    cached?: boolean;
  };
}

/**
 * Message format for chat completions
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Interface for LLM provider implementations
 */
export interface LLMProvider {
  /**
   * Get a completion from the LLM
   */
  getCompletion<T>(
    messages: LLMMessage[],
    options?: LLMCompletionOptions,
    responseFormat?: { type: string; schema?: object }
  ): Promise<LLMResponse<T>>;
  
  /**
   * Get embeddings for text
   */
  getEmbeddings(text: string | string[]): Promise<LLMResponse<number[][]>>;
  
  /**
   * List available models (optional)
   */
  listModels?(): Promise<string[]>;
  
  /**
   * Check if the service is healthy (optional)
   */
  healthCheck?(): Promise<boolean>;
  
  /**
   * Get the provider type
   */
  getProvider(): LLMProviderType;
  
  /**
   * Get the current model
   */
  getModel(): string;
}

/**
 * Model information from provider
 */
export interface LLMModel {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
  permission?: any[];
  root?: string;
  parent?: string;
}

/**
 * Provider-specific configurations
 */
export interface VLLMConfig {
  tensorParallelSize?: number;
  dtype?: string;
  maxModelLen?: number;
  gpuMemoryUtilization?: number;
}

export interface OllamaConfig {
  keepAlive?: string;
  numParallel?: number;
}

export interface LocalAIConfig {
  threads?: number;
  contextSize?: number;
  modelsPath?: string;
}

export interface LiteLLMConfig {
  proxyBaseUrl?: string;
  masterKey?: string;
  routePrefix?: string;
}

/**
 * Extended configuration with provider-specific options
 */
export interface ExtendedLLMConfig extends LLMConfig {
  vllm?: VLLMConfig;
  ollama?: OllamaConfig;
  localai?: LocalAIConfig;
  litellm?: LiteLLMConfig;
}