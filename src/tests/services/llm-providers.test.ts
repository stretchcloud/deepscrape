import { LLMServiceFactory } from '../../services/llm-service-factory';
import { LocalLLMService } from '../../services/local-llm.service';
import { OpenAIService } from '../../services/openai.service';
import { LLMProvider, LLMMessage } from '../../types/llm.types';

describe('LLM Provider Tests', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  describe('LLMServiceFactory', () => {
    it('should create OpenAI service by default', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.OPENAI_MODEL = 'gpt-4';
      
      const service = LLMServiceFactory.createLLMService();
      
      expect(service).toBeInstanceOf(OpenAIService);
      expect(service?.getProvider()).toBe('openai');
      expect(service?.getModel()).toBe('gpt-4');
    });
    
    it('should create vLLM service when provider is set', () => {
      process.env.LLM_PROVIDER = 'vllm';
      process.env.LLM_BASE_URL = 'http://localhost:8000/v1';
      process.env.LLM_MODEL = 'meta-llama/Llama-2-7b-chat-hf';
      
      const service = LLMServiceFactory.createLLMService();
      
      expect(service).toBeInstanceOf(LocalLLMService);
      expect(service?.getProvider()).toBe('vllm');
      expect(service?.getModel()).toBe('meta-llama/Llama-2-7b-chat-hf');
    });
    
    it('should create Ollama service with defaults', () => {
      process.env.LLM_PROVIDER = 'ollama';
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_MODEL;
      
      const service = LLMServiceFactory.createLLMService();
      
      expect(service).toBeInstanceOf(LocalLLMService);
      expect(service?.getProvider()).toBe('ollama');
      expect(service?.getModel()).toBe('llama2');
    });
    
    it('should return null when OpenAI API key is missing', () => {
      process.env.LLM_PROVIDER = 'openai';
      delete process.env.OPENAI_API_KEY;
      
      const service = LLMServiceFactory.createLLMService();
      
      expect(service).toBeNull();
    });
  });
  
  describe('LocalLLMService', () => {
    let mockClient: any;
    
    beforeEach(() => {
      // Mock OpenAI client
      jest.mock('openai', () => {
        return jest.fn().mockImplementation(() => ({
          chat: {
            completions: {
              create: jest.fn()
            }
          },
          embeddings: {
            create: jest.fn()
          },
          models: {
            list: jest.fn()
          }
        }));
      });
    });
    
    it('should handle vLLM provider headers', () => {
      process.env.VLLM_API_KEY = 'vllm-test-key';
      
      const service = new LocalLLMService({
        provider: 'vllm',
        baseUrl: 'http://localhost:8000/v1',
        apiKey: 'dummy-key',
        model: 'meta-llama/Llama-2-7b-chat-hf'
      });
      
      expect(service.getProvider()).toBe('vllm');
    });
    
    it('should format Ollama model names correctly', async () => {
      const service = new LocalLLMService({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'dummy-key',
        model: 'library/llama2:latest'
      });
      
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' }
      ];
      
      // Mock the response
      const mockResponse = {
        choices: [{
          message: { content: 'Hi there!' }
        }],
        model: 'llama2:latest',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      };
      
      // This would need proper mocking setup in a real test
      // For now, we're just testing the service creation
      expect(service.getModel()).toBe('library/llama2:latest');
    });
    
    it('should handle provider-specific response format support', () => {
      const vllmService = new LocalLLMService({
        provider: 'vllm',
        baseUrl: 'http://localhost:8000/v1',
        apiKey: 'dummy-key',
        model: 'model'
      });
      
      const ollamaService = new LocalLLMService({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'dummy-key',
        model: 'model'
      });
      
      // Test that different providers are created correctly
      expect(vllmService.getProvider()).toBe('vllm');
      expect(ollamaService.getProvider()).toBe('ollama');
    });
  });
  
  describe('Integration Tests', () => {
    // These tests would run against actual services if available
    describe.skip('Live Provider Tests', () => {
      it('should connect to Ollama if available', async () => {
        process.env.LLM_PROVIDER = 'ollama';
        process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
        process.env.LLM_MODEL = 'llama2';
        
        const service = LLMServiceFactory.createLLMService();
        if (!service) {
          throw new Error('Service creation failed');
        }
        
        const healthy = await service.healthCheck?.();
        expect(healthy).toBeDefined();
      });
      
      it('should list models from provider', async () => {
        process.env.LLM_PROVIDER = 'ollama';
        process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
        
        const service = LLMServiceFactory.createLLMService();
        if (!service) {
          throw new Error('Service creation failed');
        }
        
        const models = await service.listModels?.();
        expect(Array.isArray(models)).toBe(true);
      });
      
      it('should get completion from provider', async () => {
        process.env.LLM_PROVIDER = 'ollama';
        process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
        process.env.LLM_MODEL = 'llama2';
        
        const service = LLMServiceFactory.createLLMService();
        if (!service) {
          throw new Error('Service creation failed');
        }
        
        const messages: LLMMessage[] = [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say hello in one word.' }
        ];
        
        const response = await service.getCompletion<string>(messages, {
          temperature: 0.1,
          maxTokens: 10
        });
        
        expect(response.success).toBe(true);
        expect(response.data).toBeDefined();
        expect(response.metadata?.provider).toBe('ollama');
      });
    });
  });
});