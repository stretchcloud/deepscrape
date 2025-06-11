# 📚 DeepScrape – Intelligent Web Scraping & LLM-Powered Extraction

> **AI-powered web scraping with intelligent extraction**

Transform any website into structured data using Playwright automation and GPT-4o extraction. Built for modern web applications, RAG pipelines, and data workflows.

## ✨ Features

- **🤖 LLM Extraction** - Convert web content to structured JSON using OpenAI
- **📦 Batch Processing** - Process multiple URLs efficiently with controlled concurrency
- **🧬 API-first** - REST endpoints secured with API keys, documented with Swagger.
- **🎭 Browser Automation** - Full Playwright support with stealth mode  
- **📝 Multiple Formats** - Output as HTML, Markdown, or plain text
- **📥 Download Options** - Individual files, ZIP archives, or consolidated JSON
- **⚡ Smart Caching** - File-based caching with configurable TTL
- **🔄 Job Queue** - Background processing with BullMQ and Redis
- **🕷️ Web Crawling** - Multi-page crawling with configurable strategies
- **🐳 Docker Ready** - One-command deployment

## 🚀 Quick Start

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
  -H "X-API-Key: your-secret-key" \
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
  -H "X-API-Key: your-secret-key" \
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

curl -X POST http://localhost:3000/api/extract-schema \
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
curl -X POST http://localhost:3000/api/extract-schema \
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
   curl -X POST http://localhost:3000/api/extract-schema \
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

## 📦 Batch Processing

Process multiple URLs efficiently with controlled concurrency, automatic retries, and comprehensive download options.

### Start Batch Processing

```bash
curl -X POST http://localhost:3000/api/batch/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "urls": [
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart",
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/deploy-vais-prompt", 
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview",
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/vertex-ai-studio-express-mode-quickstart",
      "https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/vertex-ai-express-mode-api-quickstart"
    ],
    "concurrency": 3,
    "options": {
      "extractorFormat": "markdown",
      "waitForTimeout": 2000,
      "stealthMode": true
    }
  }'
```

Response:
```json
{
  "success": true,
  "batchId": "550e8400-e29b-41d4-a716-446655440000",
  "totalUrls": 5,
  "estimatedTime": 50000,
  "statusUrl": "http://localhost:3000/api/batch/scrape/550e8400.../status"
}
```

### Monitor Batch Progress

```bash
curl -X GET http://localhost:3000/api/batch/scrape/{batchId}/status \
  -H "X-API-Key: your-secret-key"
```

Response:
```json
{
  "success": true,
  "batchId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "totalUrls": 5,
  "completedUrls": 4,
  "failedUrls": 1,
  "progress": 100,
  "processingTime": 45230,
  "results": [...]
}
```

### Download Results

#### 1. Download as ZIP Archive (Recommended)
```bash
# Download all results as markdown files in a ZIP
curl -X GET "http://localhost:3000/api/batch/scrape/{batchId}/download/zip?format=markdown" \
  -H "X-API-Key: your-secret-key" \
  --output "batch_results.zip"

# Extract the ZIP to get individual files
unzip batch_results.zip
```

ZIP Contents:
```
1_example_com_page1.md
2_example_com_page2.md  
3_example_com_page3.md
4_docs_example_com_api.md
batch_summary.json
```

#### 2. Download Individual Results
```bash
# Get job IDs from status endpoint, then download individual files
curl -X GET "http://localhost:3000/api/batch/scrape/{batchId}/download/{jobId}?format=markdown" \
  -H "X-API-Key: your-secret-key" \
  --output "page1.md"
```

#### 3. Download Consolidated JSON
```bash
# All results in a single JSON file
curl -X GET "http://localhost:3000/api/batch/scrape/{batchId}/download/json" \
  -H "X-API-Key: your-secret-key" \
  --output "batch_results.json"
```

### Advanced Batch Options

```bash
curl -X POST http://localhost:3000/api/batch/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "urls": ["https://example.com", "https://example.org"],
    "concurrency": 5,
    "timeout": 300000,
    "maxRetries": 3,
    "failFast": false,
    "webhook": "https://your-app.com/webhook",
    "options": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true,
      "waitForTimeout": 5000,
      "blockAds": true,
      "actions": [
        {"type": "click", "selector": ".accept-cookies", "optional": true},
        {"type": "wait", "timeout": 2000}
      ]
    }
  }'
```

### Cancel Batch Processing

```bash
curl -X DELETE http://localhost:3000/api/batch/scrape/{batchId} \
  -H "X-API-Key: your-secret-key"
```

### Web Crawling

Start a multi-page crawl (automatically exports markdown files):

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
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

Response includes output directory:
```json
{
  "success": true,
  "id": "abc123-def456",
  "url": "http://localhost:3000/api/crawl/abc123-def456",
  "message": "Crawl initiated successfully. Individual pages will be exported as markdown files.",
  "outputDirectory": "./crawl-output/abc123-def456"
}
```

Check crawl status (includes exported files info):

```bash
curl http://localhost:3000/api/crawl/{job-id} \
  -H "X-API-Key: your-secret-key"
```

Status response shows exported files:
```json
{
  "success": true,
  "status": "completed",
  "crawl": {...},
  "jobs": [...],
  "count": 15,
  "exportedFiles": {
    "count": 15,
    "outputDirectory": "./crawl-output/abc123-def456",
    "files": ["./crawl-output/abc123-def456/2024-01-15_abc123_example.com_page1.md", ...]
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scrape` | POST | Scrape single URL |
| `/api/extract-schema` | POST | Extract structured data |
| `/api/summarize` | POST | Generate content summary |
| `/api/batch/scrape` | POST | Start batch processing |
| `/api/batch/scrape/:id/status` | GET | Get batch status |
| `/api/batch/scrape/:id/download/zip` | GET | Download batch as ZIP |
| `/api/batch/scrape/:id/download/json` | GET | Download batch as JSON |
| `/api/batch/scrape/:id/download/:jobId` | GET | Download individual result |
| `/api/batch/scrape/:id` | DELETE | Cancel batch processing |
| `/api/crawl` | POST | Start web crawl |
| `/api/crawl/:id` | GET | Get crawl status |
| `/api/cache` | DELETE | Clear cache |

## ⚙️ Configuration Options

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

# Crawl file export
CRAWL_OUTPUT_DIR=./crawl-output
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

### Crawl File Export

Each crawled page is automatically exported as a markdown file with:

- **Filename format**: `YYYY-MM-DD_crawlId_hostname_path.md`
- **YAML frontmatter** with metadata (URL, title, crawl date, status)
- **Organized structure**: `./crawl-output/{crawl-id}/`
- **Automatic summary**: Generated when crawl completes

**Example file structure:**
```
crawl-output/
├── abc123-def456/
│   ├── 2024-01-15_abc123_docs.example.com_getting-started.md
│   ├── 2024-01-15_abc123_docs.example.com_api-reference.md
│   ├── 2024-01-15_abc123_docs.example.com_tutorials.md
│   ├── abc123-def456_summary.md
│   ├── abc123-def456_consolidated.md    # 🆕 All pages in one file
│   └── abc123-def456_consolidated.json  # 🆕 Structured JSON export
└── xyz789-ghi012/
    └── ...
```

**Consolidated Export Features:**
- **Single Markdown**: All crawled pages combined into one readable file
- **JSON Export**: Structured data with metadata for programmatic use
- **Auto-Generated**: Created automatically when crawl completes
- **Rich Metadata**: Preserves all page metadata and crawl statistics

**File content example:**
```markdown
---
url: "https://docs.example.com/getting-started"
title: "Getting Started Guide"
crawled_at: "2024-01-15T10:30:00.000Z"
status: 200
content_type: "markdown"
load_time: 1250ms
browser_mode: false
---

# Getting Started Guide

Welcome to the getting started guide...
```

## 🏗️ Architecture

```text
┌───────────────┐    REST     ┌────────────────────────┐
│    Client     │────────────▶│  Express API Gateway   │
└───────────────┘             └────────┬───────────────┘
                                        │ (Job Payload)
                                        ▼
                             ┌───────────────────────┐
                             │   BullMQ Job Queue    │ (Redis)
                             └────────┬──────────────┘
                                      │
                           pulls job   │ pushes result
                                      ▼
 ┌─────────────────┐ Playwright ┌─────────────────┐  GPT-4o ┌──────────────┐
 │ Scraper Worker  │──────────▶│  Extractor      │────────▶│ OpenAI       │
 └─────────────────┘           └─────────────────┘         └──────────────┘
   (Headless Browser)            (HTML → MD/Text/JSON)          (LLM API)
                                      │
                                      ▼
                                Cache Layer (FS/Redis)
```

## 🛣️ Roadmap

- [x] 📦 Batch processing with controlled concurrency
- [x] 📥 Multiple download formats (ZIP, JSON, individual files)
- [ ] 🚸 Browser pooling & warm-up
- [ ] 🧠 Automatic schema generation (LLM)
- [ ] 📊 Prometheus metrics & Grafana dashboard
- [ ] 🌐 Cloud-native cache backends (S3/Redis)
- [ ] 🌈 Web UI playground
- [ ] 🔔 Advanced webhook payloads with retry logic
- [ ] 📈 Batch processing analytics and insights

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