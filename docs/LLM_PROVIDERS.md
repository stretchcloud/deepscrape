# LLM Provider Integration Guide

DeepScrape now supports multiple LLM providers for AI-powered data extraction. This guide covers how to configure and use different LLM providers.

## Table of Contents
- [Supported Providers](#supported-providers)
- [Quick Start](#quick-start)
- [Provider Configuration](#provider-configuration)
- [Docker Setup](#docker-setup)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Supported Providers

| Provider | Description | Best For |
|----------|-------------|----------|
| **OpenAI** | Cloud-based GPT models | Production, high accuracy |
| **vLLM** | High-performance local inference | GPU servers, low latency |
| **Ollama** | Easy local model runner | Development, privacy |
| **LocalAI** | OpenAI-compatible local API | CPU inference, flexibility |
| **LiteLLM** | Unified API for 100+ LLMs | Multi-provider routing |
| **Custom** | Any OpenAI-compatible API | Custom deployments |

## Quick Start

### 1. Set Provider in Environment

```bash
# .env file
LLM_PROVIDER=ollama  # Options: openai, vllm, ollama, localai, litellm, custom
```

### 2. Start Provider with Docker

```bash
# Start Ollama
make llm-ollama

# Or start vLLM (requires GPU)
make llm-vllm

# Or start LocalAI
make llm-localai
```

### 3. Test the Provider

```bash
make llm-test
```

### 4. Run DeepScrape

```bash
npm run dev
```

## Provider Configuration

### OpenAI (Default)

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4o
```

### vLLM

```env
LLM_PROVIDER=vllm
LLM_BASE_URL=http://localhost:8000/v1
LLM_MODEL=meta-llama/Llama-2-7b-chat-hf
VLLM_TENSOR_PARALLEL_SIZE=1
VLLM_GPU_MEMORY_UTILIZATION=0.9
```

**Docker Command:**
```bash
docker-compose -f docker-compose.yml \
  -f docker-compose.llm.yml \
  -f docker/llm-providers/docker-compose.vllm.yml \
  up -d
```

### Ollama

```env
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama2
OLLAMA_KEEP_ALIVE=5m
OLLAMA_NUM_PARALLEL=4
```

**Docker Command:**
```bash
make llm-ollama
```

**Pull a Model:**
```bash
docker exec deepscrape-ollama ollama pull llama2
docker exec deepscrape-ollama ollama pull mistral
docker exec deepscrape-ollama ollama pull codellama
```

### LocalAI

```env
LLM_PROVIDER=localai
LLM_BASE_URL=http://localhost:8080/v1
LLM_MODEL=ggml-gpt4all-j
LOCALAI_CONTEXT_SIZE=2048
LOCALAI_THREADS=4
```

**Docker Command:**
```bash
make llm-localai
```

### LiteLLM

```env
LLM_PROVIDER=litellm
LLM_BASE_URL=http://localhost:4000
LLM_MODEL=gpt-3.5-turbo
LITELLM_MASTER_KEY=sk-1234

# Optional: Configure multiple providers
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
GOOGLE_API_KEY=your-google-key
```

**Docker Command:**
```bash
make llm-litellm
```

### Custom Provider

```env
LLM_PROVIDER=custom
LLM_BASE_URL=http://your-server:8000/v1
LLM_API_KEY=your-api-key
LLM_MODEL=your-model
CUSTOM_LLM_AUTH_HEADER=Authorization
CUSTOM_LLM_SUPPORTS_JSON=true
```

## Docker Setup

### Using Docker Compose

All providers can be started using Docker Compose:

```bash
# Start main app with Redis
docker-compose up -d

# Add LLM provider (example: Ollama)
docker-compose -f docker-compose.yml \
  -f docker-compose.llm.yml \
  -f docker/llm-providers/docker-compose.ollama.yml \
  up -d
```

### Using Makefile

The Makefile provides convenient commands:

```bash
# Start providers
make llm-vllm       # Start vLLM
make llm-ollama     # Start Ollama
make llm-localai    # Start LocalAI
make llm-litellm    # Start LiteLLM

# Run with specific provider
make run-with-ollama
make run-with-vllm

# View logs
make logs-ollama
make logs-vllm

# Stop all providers
make llm-down
```

### GPU Support

For GPU-accelerated inference (vLLM, LocalAI with CUDA):

1. Install NVIDIA Docker runtime
2. Ensure CUDA is available
3. The docker-compose files automatically request GPU resources

## Testing

### Test Script

Run the provider test script:

```bash
npx ts-node scripts/test-llm-provider.ts
```

This tests:
- Health check
- Model listing
- Simple completion
- JSON responses
- Embeddings

### Unit Tests

```bash
npm test -- llm-providers.test.ts
```

### Manual Testing

```bash
# Test Ollama
curl http://localhost:11434/v1/models

# Test vLLM
curl http://localhost:8000/v1/models

# Test LocalAI
curl http://localhost:8080/readyz
```

## Troubleshooting

### Common Issues

**Provider not responding:**
```bash
# Check if container is running
docker ps | grep deepscrape

# Check logs
docker logs deepscrape-ollama
docker logs deepscrape-vllm
```

**Model not found:**
```bash
# For Ollama - pull the model
docker exec deepscrape-ollama ollama pull llama2

# For LocalAI - check model configuration
ls config/localai/
```

**GPU not detected (vLLM/LocalAI):**
```bash
# Check NVIDIA runtime
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# Check docker daemon config
cat /etc/docker/daemon.json | grep nvidia
```

**Connection refused:**
- Ensure the provider container is healthy
- Check firewall/network settings
- Verify the base URL in your .env file

### Performance Tips

1. **vLLM**: Best for GPU servers, supports tensor parallelism
2. **Ollama**: Good for development, easy model management
3. **LocalAI**: Works on CPU, supports multiple model formats
4. **LiteLLM**: Use for load balancing across providers

### Model Selection

Choose models based on your needs:

| Use Case | Recommended Model | Provider |
|----------|------------------|----------|
| General QA | llama2, mistral | Ollama |
| Code Analysis | codellama | Ollama |
| High Accuracy | gpt-4, claude-3 | OpenAI/LiteLLM |
| Fast Inference | Llama-2-7b | vLLM |
| CPU Only | ggml-gpt4all-j | LocalAI |

## Advanced Configuration

### LiteLLM Router

Configure `config/litellm/config.yaml` for advanced routing:

```yaml
model_list:
  - model_name: fast-model
    litellm_params:
      model: ollama/mistral
      api_base: http://ollama:11434
  
  - model_name: accurate-model
    litellm_params:
      model: openai/gpt-4
      api_key: ${OPENAI_API_KEY}

router_settings:
  routing_strategy: "latency-based-routing"
  fallback_models:
    accurate-model: ["fast-model"]
```

### Custom Provider Integration

For custom OpenAI-compatible APIs:

1. Update `docker-compose.custom.yml`
2. Set environment variables
3. Implement any special headers in `local-llm.service.ts`

```typescript
case 'custom':
  // Add your custom logic
  if (process.env.CUSTOM_AUTH_TYPE === 'bearer') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  break;
```

## Monitoring

Monitor LLM usage:

```bash
# View provider logs
docker logs -f deepscrape-ollama

# Check metrics (if configured)
curl http://localhost:3000/metrics

# Monitor with DeepScrape logs
tail -f logs/combined.log | grep LLM
```