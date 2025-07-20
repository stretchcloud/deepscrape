.PHONY: help build test clean docker-up docker-down llm-test

# Default target
help:
	@echo "DeepScrape Makefile Commands:"
	@echo "  make build          - Build the TypeScript project"
	@echo "  make test           - Run all tests"
	@echo "  make clean          - Clean build artifacts and logs"
	@echo "  make docker-up      - Start all services with Docker"
	@echo "  make docker-down    - Stop all Docker services"
	@echo ""
	@echo "LLM Provider Commands:"
	@echo "  make llm-vllm       - Start vLLM provider"
	@echo "  make llm-ollama     - Start Ollama provider"
	@echo "  make llm-localai    - Start LocalAI provider"
	@echo "  make llm-litellm    - Start LiteLLM provider"
	@echo "  make llm-test       - Test current LLM provider"
	@echo "  make llm-down       - Stop all LLM providers"

# Build the project
build:
	npm run build

# Run tests
test:
	npm test

# Run LLM provider tests
llm-test:
	npx ts-node scripts/test-llm-provider.ts

# Clean build artifacts
clean:
	rm -rf dist
	rm -rf logs/*.log
	rm -rf cache/*

# Main Docker commands
docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

# LLM Provider specific commands
llm-vllm:
	@echo "Starting vLLM provider..."
	docker-compose -f docker-compose.yml -f docker-compose.llm.yml -f docker/llm-providers/docker-compose.vllm.yml up -d redis vllm

llm-ollama:
	@echo "Starting Ollama provider..."
	@if [ "$$(uname)" = "Darwin" ]; then \
		echo "Detected macOS - using CPU-only configuration"; \
		docker-compose -f docker-compose.yml -f docker-compose.llm.yml -f docker/llm-providers/docker-compose.ollama-mac.yml up -d redis ollama ollama-loader; \
	else \
		docker-compose -f docker-compose.yml -f docker-compose.llm.yml -f docker/llm-providers/docker-compose.ollama.yml up -d redis ollama ollama-loader; \
	fi

llm-localai:
	@echo "Starting LocalAI provider..."
	docker-compose -f docker-compose.yml -f docker-compose.llm.yml -f docker/llm-providers/docker-compose.localai.yml up -d redis localai localai-downloader

llm-litellm:
	@echo "Starting LiteLLM provider..."
	docker-compose -f docker-compose.yml -f docker-compose.llm.yml -f docker/llm-providers/docker-compose.litellm.yml up -d redis litellm

llm-custom:
	@echo "Starting custom LLM provider..."
	docker-compose -f docker-compose.yml -f docker-compose.llm.yml -f docker/llm-providers/docker-compose.custom.yml up -d redis custom-llm

# Stop all LLM providers
llm-down:
	@echo "Stopping all LLM providers..."
	docker-compose -f docker-compose.yml -f docker-compose.llm.yml \
		-f docker/llm-providers/docker-compose.vllm.yml \
		-f docker/llm-providers/docker-compose.ollama.yml \
		-f docker/llm-providers/docker-compose.localai.yml \
		-f docker/llm-providers/docker-compose.litellm.yml \
		-f docker/llm-providers/docker-compose.custom.yml \
		down

# Run DeepScrape with specific LLM provider
run-with-vllm: llm-vllm
	@echo "Waiting for vLLM to start..."
	@sleep 10
	LLM_PROVIDER=vllm npm run dev

run-with-ollama: llm-ollama
	@echo "Waiting for Ollama to start..."
	@sleep 10
	LLM_PROVIDER=ollama npm run dev

run-with-localai: llm-localai
	@echo "Waiting for LocalAI to start..."
	@sleep 10
	LLM_PROVIDER=localai npm run dev

run-with-litellm: llm-litellm
	@echo "Waiting for LiteLLM to start..."
	@sleep 10
	LLM_PROVIDER=litellm npm run dev

# Development helpers
dev:
	npm run dev

lint:
	npm run lint

lint-fix:
	npm run lint:fix

# Show logs for specific providers
logs-vllm:
	docker-compose -f docker/llm-providers/docker-compose.vllm.yml logs -f vllm

logs-ollama:
	docker-compose -f docker/llm-providers/docker-compose.ollama.yml logs -f ollama

logs-localai:
	docker-compose -f docker/llm-providers/docker-compose.localai.yml logs -f localai

logs-litellm:
	docker-compose -f docker/llm-providers/docker-compose.litellm.yml logs -f litellm