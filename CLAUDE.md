# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

DeepScrape is an AI-powered web scraping framework with REST API that combines browser automation (Playwright) with LLM-powered data extraction. It supports both cloud (OpenAI) and local LLMs (Ollama, vLLM, LocalAI, LiteLLM) for privacy-focused deployments.

## Essential Commands

### Development
- `npm run dev` - Start development server with ts-node
- `npm run build` - Compile TypeScript to JavaScript
- `npm test` - Run Jest tests
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Auto-fix linting issues
- `npx jest src/tests/services/llm-providers.test.ts` - Run specific test file

### Docker & LLM Providers
- `make llm-ollama` - Start Ollama provider (auto-detects macOS for CPU-only mode)
- `make llm-vllm` - Start vLLM provider
- `make llm-test` - Test current LLM provider configuration
- `make docker-up` - Start all services with Docker
- `make docker-down` - Stop all Docker services

## Architecture

### Layer Structure
```
API Layer (Express + Swagger)
    ↓
Services Layer (Business Logic)
    ↓
Core Components (Scraping, Crawling, Transformation)
    ↓
External Dependencies (Playwright, Redis, LLMs)
```

### Key Service Patterns

1. **LLM Service Factory Pattern** (`/src/services/llm-service-factory.ts`):
   - Creates appropriate LLM service based on `LLM_PROVIDER` env variable
   - Supports OpenAI, Ollama, vLLM, LocalAI, LiteLLM
   - Each provider extends base `LLMService` interface

2. **Queue System** (`/src/services/queue.service.ts`, `enhanced-queue.service.ts`):
   - BullMQ with Redis for job processing
   - Handles batch scraping operations
   - Configurable concurrency and retries

3. **Scraper Manager** (`/src/scraper/scraper-manager.ts`):
   - Orchestrates different scraper types (Playwright, HTTP)
   - Manages caching, transformations, and LLM extraction
   - Central entry point for all scraping operations

### API Endpoints Structure
All endpoints are defined in `/src/api/routes/` and documented in `swagger.yaml`:
- `/api/scrape` - Single URL scraping
- `/api/extract-schema` - Schema-based extraction with LLM
- `/api/summarize` - Content summarization
- `/api/batch-scrape` - Multiple URL processing
- `/api/crawl` - Multi-page crawling

### Testing Approach
- Test files in `/src/tests/` mirror source structure
- Use Jest with ts-jest for TypeScript support
- Mock external dependencies (LLMs, Playwright) for unit tests
- Integration tests available via `make llm-test`

## Environment Configuration

Required environment variables:
- `API_KEY` - API authentication
- `LLM_PROVIDER` - Provider choice (openai, ollama, vllm, localai, litellm)
- `OPENAI_API_KEY` - For OpenAI provider
- `LLM_BASE_URL` - For local LLM providers
- `LLM_MODEL` - Model selection
- `REDIS_HOST` - Redis connection

## Important Notes

1. **LLM Provider Integration**: When adding new LLM providers, extend `LocalLLMService` class and update `LLMServiceFactory`

2. **Scraping Strategy**: The system uses Playwright for JavaScript-heavy sites and falls back to HTTP scraping for simple content

3. **Caching**: File-based caching is enabled by default in `/cache` directory with configurable TTL

4. **Docker Deployment**: Multiple compose files handle different LLM providers - see `/docker/llm-providers/`

5. **API Security**: All endpoints require `X-API-Key` header authentication