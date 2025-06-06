# 📚 DeepScrape – Intelligent Web Scraping & LLM-Powered Extraction

> **AI-powered web scraping with intelligent extraction**

Transform any website into structured data using Playwright automation and GPT-4o extraction. Built for modern web applications, RAG pipelines, and data workflows.

## Features

- **🤖 LLM Extraction** - Convert web content to structured JSON using OpenAI
- **🧬 API-first** - REST endpoints secured with API keys, documented with Swagger.
- **🎭 Browser Automation** - Full Playwright support with stealth mode  
- **📝 Multiple Formats** - Output as HTML, Markdown, or plain text
- **⚡ Smart Caching** - File-based caching with configurable TTL
- **🔄 Job Queue** - Background processing with BullMQ and Redis
- **🕷️ Web Crawling** - Multi-page crawling with configurable strategies
- **🐳 Docker Ready** - One-command deployment

## Quick Start

### 1. Installation

```bash
git clone https://github.com/stretchcloud/deepscrape.git
cd deepscrape
npm install
cp .env.example .env
```

### 2. Configuration

Edit `.env` with your settings:

```env
API_KEY=your-secret-key
OPENAI_API_KEY=your-openai-key
REDIS_HOST=localhost
CACHE_ENABLED=true
```

### 3. Start Server

```bash
npm run dev
```

Test: `curl http://localhost:3000/health`

## API Usage

### Basic Scraping

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-key" \
  -d '{
    "url": "https://example.com",
    "options": { "extractorFormat": "markdown" }
  }' | jq -r '.content' > content.md
```

### Schema-Based Extraction

Extract structured data using JSON Schema:

```bash
curl -X POST http://localhost:3000/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-key" \
  -d '{
    "url": "https://news.example.com/article",
    "schema": {
      "type": "object",
      "properties": {
        "title": { 
          "type": "string", 
          "description": "Article headline" 
        },
        "author": { 
          "type": "string", 
          "description": "Author name" 
        },
        "publishDate": { 
          "type": "string", 
          "description": "Publication date" 
        }
      },
      "required": ["title"]
    }
  }' | jq -r '.extractedData' > schemadata.md
```

### Summarize URL Content

Scrapes a URL and uses an LLM (GPT-4o) to generate a concise summary of its content.

```bash
curl -X POST http://localhost:3000/api/summarize \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-key" \
  -d '{
    "url": "https://en.wikipedia.org/wiki/Large_language_model",
    "maxLength": 300,
    "options": {
      "temperature": 0.3,
      "waitForSelector": "body",
      "extractorFormat": "markdown"
    }
  }' | jq -r '.summary' > summary-output.md
  ```

### Technical Documentation Analysis

Extract key information from technical documentation:

```bash

curl -X POST http://20.106.223.252:3000/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-key" \
  -d '{
    "url": "https://docs.github.com/en/rest/overview/permissions-required-for-github-apps",
    "schema": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "overview": {"type": "string"},
        "permissionCategories": {"type": "array", "items": {"type": "string"}},
        "apiEndpoints": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "endpoint": {"type": "string"},
              "requiredPermissions": {"type": "array", "items": {"type": "string"}}
            }
          }
        }
      },
      "required": ["title", "overview"]
    },
    "options": {
      "extractorFormat": "markdown"
    }
  }' | jq -r '.extractedData' > output.md
```  

### Comparative Analysis from Academic Papers

Extract and compare methodologies from research papers:

```bash
curl -X POST http://20.106.223.252:3000/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-key" \
  -d '{
    "url": "https://arxiv.org/abs/2005.14165",
    "schema": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "authors": {"type": "array", "items": {"type": "string"}},
        "abstract": {"type": "string"},
        "methodology": {"type": "string"},
        "results": {"type": "string"},
        "keyContributions": {"type": "array", "items": {"type": "string"}},
        "citations": {"type": "number"}
      }
    },
    "options": {
      "extractorFormat": "markdown"
    }
  }' | jq -r '.extractedData' > output.md
```

### Complex Data Analysis from Medium Articles

Extract complex data structure from any medium articles

```bash
   curl -X POST http://20.106.223.252:3000/api/extract-schema \
     -H "Content-Type: application/json" \
     -H "X-API-Key: test-key" \
     -d '{
       "url": "https://johnchildseddy.medium.com/typescript-llms-lessons-learned-from-9-months-in-production-4910485e3272",
       "schema": {
         "type": "object",
         "properties": {
           "title": {"type": "string"},
           "author": {"type": "string"},
           "keyInsights": {"type": "array", "items": {"type": "string"}},
           "technicalChallenges": {"type": "array", "items": {"type": "string"}},
           "businessImpact": {"type": "string"}
         }
       },
	"options": {
      "extractorFormat": "markdown"
    }
  }' | jq -r '.extractedData' > output.md
```


### Web Crawling

Start a multi-page crawl:

```bash
curl -X POST http://localhost:3000/api/v1/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 50,
    "maxDepth": 3,
    "strategy": "bfs",
    "includePaths": ["^/docs/.*"],
    "scrapeOptions": {
      "extractorFormat": "markdown"
    }
  }'
```

Check crawl status:

```bash
curl http://localhost:3000/api/v1/crawl/{job-id}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scrape` | POST | Scrape single URL |
| `/api/extract-schema` | POST | Extract structured data |
| `/api/summarize` | POST | Generate content summary |
| `/api/v1/crawl` | POST | Start web crawl |
| `/api/v1/crawl/:id` | GET | Get crawl status |
| `/api/cache` | DELETE | Clear cache |

## Configuration Options

### Environment Variables

```env
# Core
API_KEY=your-secret-key
PORT=3000

# OpenAI
OPENAI_API_KEY=your-key
OPENAI_DEPLOYMENT_NAME=gpt-4o
LLM_TEMPERATURE=0.2

# Cache
CACHE_ENABLED=true
CACHE_TTL=3600
CACHE_DIRECTORY=./cache

# Redis (for job queue)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Scraper Options

```typescript
interface ScraperOptions {
  extractorFormat?: 'html' | 'markdown' | 'text'
  waitForSelector?: string
  waitForTimeout?: number
  actions?: BrowserAction[]  // click, scroll, wait, fill
  skipCache?: boolean
  cacheTtl?: number
  stealthMode?: boolean
  proxy?: string
  userAgent?: string
}
```

## Docker Deployment

```bash
# Build and run
docker build -t deepscrape .
docker run -d -p 3000:3000 --env-file .env deepscrape

# Or use docker-compose
docker-compose up -d
```

## Advanced Features

### Browser Actions

Interact with dynamic content:

```json
{
  "url": "https://example.com",
  "options": {
    "actions": [
      { "type": "click", "selector": "#load-more" },
      { "type": "wait", "timeout": 2000 },
      { "type": "scroll", "position": 1000 }
    ]
  }
}
```

### Crawl Strategies

- **BFS** (default) - Breadth-first exploration
- **DFS** - Depth-first for deep content
- **Best-First** - Priority-based on content relevance

### Schema Extraction Tips

- Use clear `description` fields in your JSON Schema
- Start with simple schemas and iterate
- Lower `temperature` values for consistent results
- Include examples in descriptions for better accuracy

## Architecture

```
Client → Express API → BullMQ Queue → Worker
                    ↓
         [Playwright Scraper] → [Content Cleaner] → [LLM Extractor]
                    ↓
              Cache Layer (File/Redis)
```

## 🛣️ Roadmap

- [ ] 🚸 Browser pooling & warm-up
- [ ] 🧠 Automatic schema generation (LLM)
- [ ] 📊 Prometheus metrics & Grafana dashboard
- [ ] 🌐 Cloud-native cache backends (S3/Redis)
- [ ] 🌈 Web UI playground

---


## License

Apache 2.0 - see [LICENSE](LICENSE) file

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

---


**Star ⭐ this repo if you find it useful!**