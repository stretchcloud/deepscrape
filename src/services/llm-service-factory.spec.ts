import { LLMServiceFactory } from './llm-service-factory';

describe('LLMServiceFactory — OpenAI-compatible endpoints', () => {
  const ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ENV };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_ORGANIZATION;
  });

  afterAll(() => {
    process.env = ENV;
  });

  it('returns null when neither a key nor a base URL is configured', () => {
    expect(LLMServiceFactory.createLLMService()).toBeNull();
  });

  it('builds a service from an API key alone (api.openai.com)', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const svc = LLMServiceFactory.createLLMService();
    expect(svc).not.toBeNull();
    expect(svc!.baseURL).toBeUndefined();
  });

  it('builds a service from a base URL alone, with no API key', () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    process.env.OPENAI_MODEL = 'llama3.1';
    const svc = LLMServiceFactory.createLLMService();
    expect(svc).not.toBeNull();
    expect(svc!.baseURL).toBe('http://localhost:11434/v1');
    expect(svc!.model).toBe('llama3.1');
  });

  it('prefers an explicit API key when both are set', () => {
    process.env.OPENAI_API_KEY = 'sk-real';
    process.env.OPENAI_BASE_URL = 'http://localhost:4000';
    const svc = LLMServiceFactory.createLLMService();
    expect(svc).not.toBeNull();
    expect(svc!.baseURL).toBe('http://localhost:4000');
  });

  it('treats a whitespace-only base URL as unset', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = '   ';
    expect(LLMServiceFactory.createLLMService()!.baseURL).toBeUndefined();
  });

  it('treats a whitespace-only API key with no base URL as unconfigured', () => {
    process.env.OPENAI_API_KEY = '   ';
    expect(LLMServiceFactory.createLLMService()).toBeNull();
  });

  it('defaults the model to gpt-4o when unset', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(LLMServiceFactory.createLLMService()!.model).toBe('gpt-4o');
  });
});
