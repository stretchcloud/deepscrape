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
- **🗺️ URL Discovery** - `/map` endpoint for discovering 5,000+ URLs in seconds
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

⚡ **New**: Enhanced crawling with `useMapDiscovery: true` - discover 1000+ URLs in seconds instead of minutes!

## 🚀 **Quick Recommendations**

### **For Maximum Performance:**
```bash
# Use /api/crawl with useMapDiscovery for best results
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.example.com",
    "useMapDiscovery": true,
    "maxUrls": 1000,
    "includePatterns": ["/api/", "/docs/"],
    "scrapeOptions": { "extractorFormat": "markdown" }
  }'
```

### **For Bot-Protected Sites:**
```bash
# Use browser-based scraping with stealth mode
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://protected-site.com",
    "useMapDiscovery": true,
    "maxUrls": 100,
    "skipSitemaps": true,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true
    }
  }'
```

### **For Rate-Limited Sites:**
```bash
# Conservative crawling with delays
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://api-limited-site.com",
    "useMapDiscovery": true,
    "maxUrls": 500,
    "crawlOptions": {
      "maxConcurrentCrawlers": 1,
      "crawlTimeoutPerPage": 8000
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "minDelay": 2000,
      "maxRetries": 3
    }
  }'
```

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

### URL Discovery (High-Performance)

Discover thousands of URLs from a website in seconds using our endpoint:

```bash
curl -X POST http://localhost:3000/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.github.com",
    "maxUrls": 1000,
    "includeSubdomains": true
  }'
```

**Performance**: Discovers 5,000+ URLs in 2-3 seconds vs. traditional crawling (100 URLs in 2-5 minutes).

### Complete `/api/map` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`url`** (string): The starting URL for discovery

**Discovery Control Options:**
- **`maxUrls`** (integer, default: 5000, max: 30000): Maximum number of URLs to discover
- **`includeSubdomains`** (boolean, default: true): Include subdomains in discovery
- **`skipSitemaps`** (boolean, default: false): Skip sitemap-based discovery
- **`sitemapsOnly`** (boolean, default: false): Use only sitemap-based discovery
- **`useUrlIndex`** (boolean, default: true): Use pre-built URL index (future feature)
- **`timeoutMs`** (integer, default: 30000, max: 300000): Discovery timeout in milliseconds

**Search & Filtering Options:**
- **`searchQuery`** (string): Optional search query for targeted discovery
- **`includePatterns`** (string[]): Include only URLs containing these path segments (e.g., `["docs", "api", "guides"]`)
- **`excludePatterns`** (string[]): Exclude URLs containing these patterns (e.g., `["admin", "login", "private"]`)

**Rate Limiting Options** (`rateLimitingOptions` object):**
- **`minDelay`** (number, default: 500): Minimum delay between requests (ms)
- **`maxConcurrency`** (number, default: 2): Maximum concurrent requests
- **`sitemapDelay`** (number, default: 300): Delay between sitemap requests (ms)
- **`batchSize`** (number, default: 3): Batch size for common path testing
- **`browserTimeout`** (number, default: 10000): Browser discovery timeout (ms)
- **`enableRetry`** (boolean, default: true): Enable exponential backoff retry
- **`maxRetries`** (number, default: 3): Maximum retry attempts

**Advanced Crawl Options** (`crawlOptions` object):**
- **`maxCrawlDepth`** (number, default: 3, max: 5): Maximum crawling depth
- **`maxConcurrentCrawlers`** (number, default: 8, max: 20): Maximum concurrent crawlers
- **`crawlTimeoutPerPage`** (number, default: 3000, max: 10000): Timeout per page in milliseconds
- **`maxLinksPerPage`** (number, default: 100, max: 500): Maximum links to extract per page
- **`enableDeepCrawling`** (boolean, default: true): Enable multi-level crawling
- **`browserPoolSize`** (number, default: 5, max: 15): Browser pool size for crawling

#### **Sample API Calls**

**Basic URL Discovery:**
```bash
curl -X POST http://localhost:3000/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.github.com",
    "maxUrls": 1000,
    "includeSubdomains": true
  }'
```

**Filtered Discovery with Patterns:**
```bash
curl -X POST http://localhost:3000/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.oracle.com/en-us/iaas/Content/home.htm",
    "maxUrls": 5000,
    "includeSubdomains": true,
    "includePatterns": ["/en-us/iaas/"],
    "excludePatterns": ["/admin/", "/login/"],
    "timeoutMs": 120000
  }'
```

**High-Performance Discovery with Enhanced Crawling:**
```bash
curl -X POST http://localhost:3000/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://cloud.google.com/docs",
    "maxUrls": 5000,
    "includeSubdomains": true,
    "timeoutMs": 120000,
    "crawlOptions": {
      "maxCrawlDepth": 4,
      "maxConcurrentCrawlers": 15,
      "crawlTimeoutPerPage": 7000,
      "maxLinksPerPage": 300,
      "enableDeepCrawling": true,
      "browserPoolSize": 15
    },
    "skipSitemaps": false,
    "sitemapsOnly": false
  }'
```

**Conservative Discovery (GitHub-safe):**
```bash
curl -X POST http://localhost:3000/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.github.com",
    "maxUrls": 1000,
    "includeSubdomains": true,
    "rateLimitingOptions": {
      "minDelay": 1000,
      "maxConcurrency": 1,
      "sitemapDelay": 500,
      "batchSize": 1,
      "browserTimeout": 20000,
      "enableRetry": true,
      "maxRetries": 2
    }
  }'
```

### Advanced Discovery with Search
```bash
curl -X POST http://localhost:3000/api/map \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.stripe.com",
    "searchQuery": "api payment webhook",
    "includePatterns": ["api", "docs"],
    "maxUrls": 500
  }'
```

**Discovery Methods** (5 parallel methods):
- **Sitemap Discovery**: XML sitemaps, robots.txt references
- **Search Engine Discovery**: Site-specific search queries  
- **Browser Crawling**: JavaScript-rendered content
- **Common Path Discovery**: `/api`, `/docs`, `/swagger` patterns
- **Robots.txt Analysis**: Extract sitemap references

**Response Format**:
```json
{
  "success": true,
  "data": {
    "links": ["https://docs.github.com/api", "..."],
    "total": 847,
    "discoveryMethods": {
      "sitemap": 400,
      "search": 200,
      "crawling": 147,
      "commonPaths": 80,
      "robotsSitemaps": 20
    },
    "timeTaken": 2340,
    "fromCache": false
  }
}
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

## 🕷️ Web Crawling

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

**🚀 Enhanced Streaming Crawling** (Recommended for large sites):

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 1000,
    "useMapDiscovery": true,
    "allowSubdomains": true,
    "includePaths": ["^/docs/.*", "^/api/.*"],
    "scrapeOptions": {
      "extractorFormat": "markdown"
    }
  }'
```

**🌟 Benefits of `useMapDiscovery: true` (Streaming Architecture + Browser Pool)**:
- **⚡ 90% faster crawling** (streaming + browser pool vs sequential discovery)
- **🏊 Browser pool management** (reuses 5 browser instances vs creating new ones)
- **🔄 Parallel processing** (5 discovery methods + scraping run simultaneously) 
- **📈 Higher success rate** (95%+ vs 85% with traditional crawling)
- **🎯 Comprehensive coverage** (sitemaps, browser crawling, common paths, robots.txt, search)
- **🧠 Intelligent filtering** (respects includePaths and excludePaths)
- **💾 Memory efficient** (streams URLs + browser reuse vs high memory usage)

### Complete `/api/crawl` Options

#### **Main Request Body Parameters**

**Required Parameters:**
- **`url`** (string): The starting URL to crawl

**Core Crawl Control Options:**
- **`limit`** (integer, default: 100): Maximum number of URLs to crawl
- **`maxDepth`** (integer, default: 5): Maximum depth to crawl from starting URL
- **`includePaths`** (string[]): Array of regex patterns for URLs to include (legacy)
- **`excludePaths`** (string[]): Array of regex patterns for URLs to exclude (legacy)
- **`allowBackwardCrawling`** (boolean, default: false): Allow crawling URLs that aren't descendants of initial URL
- **`allowExternalContentLinks`** (boolean, default: false): Allow crawling external domain links
- **`allowSubdomains`** (boolean, default: false): Allow crawling subdomains
- **`ignoreRobotsTxt`** (boolean, default: false): Ignore robots.txt rules
- **`regexOnFullURL`** (boolean, default: false): Apply regex patterns to full URLs instead of just paths

**Strategy & Discovery Options:**
- **`strategy`** (enum): Crawling strategy
  - `"bfs"` (default): Breadth-First Search
  - `"dfs"`: Depth-First Search  
  - `"best_first"`: Best-First Search (prioritized)
- **`useBrowser`** (boolean, default: false): Use browser-based crawling with Playwright
- **`useMapDiscovery`** (boolean, default: false): 🚀 **Enable high-performance URL discovery** (finds 5,000+ URLs in seconds)

**Enhanced Map Discovery Options** (when `useMapDiscovery: true`):
- **`maxUrls`** (integer, default: 5000, max: 30000): Maximum URLs to discover (overrides `limit`)
- **`timeoutMs`** (integer, default: 120000, max: 300000): Discovery timeout in milliseconds
- **`skipSitemaps`** (boolean, default: false): Skip sitemap-based discovery (faster for browser-only discovery)
- **`sitemapsOnly`** (boolean, default: false): Use only sitemap-based discovery (fastest but limited)
- **`includePatterns`** (string[]): Include only URLs matching these path patterns (overrides `includePaths`)
- **`excludePatterns`** (string[]): Exclude URLs matching these patterns (overrides `excludePaths`)

**Advanced Crawl Options** (`crawlOptions` object when `useMapDiscovery: true`):
- **`maxCrawlDepth`** (number, default: 3, max: 5): Browser crawling depth for URL discovery
- **`maxConcurrentCrawlers`** (number, default: 8, max: 20): Concurrent browser crawlers for discovery
- **`crawlTimeoutPerPage`** (number, default: 3000, max: 10000): Timeout per page during discovery (ms)
- **`maxLinksPerPage`** (number, default: 100, max: 500): Maximum links to extract per page during discovery
- **`enableDeepCrawling`** (boolean, default: true): Enable multi-level crawling during discovery
- **`browserPoolSize`** (number, default: 5, max: 15): Browser pool size for discovery crawling

**Notification Options:**
- **`webhook`** (string): URL to call when crawl completes

#### **Scrape Options** (`scrapeOptions` object)

**Basic Scraping Options:**
- **`timeout`** (number): Request timeout in milliseconds
- **`extractorFormat`** (enum): Output format
  - `"html"`: Raw HTML
  - `"markdown"` (recommended): Clean markdown
  - `"text"`: Plain text only
- **`waitForTimeout`** (number): Time to wait after page loads (ms)
- **`waitForSelector`** (string): CSS selector to wait for before scraping
- **`skipTlsVerification`** (boolean): Skip TLS verification for HTTPS

**Browser Options:**
- **`javascript`** (boolean): Enable JavaScript execution
- **`fullPage`** (boolean): Capture full page content
- **`stealthMode`** (boolean): Enable stealth mode to avoid detection
- **`maxScrolls`** (number): Maximum scrolls for dynamic content
- **`blockAds`** (boolean): Block advertisements
- **`blockResources`** (boolean): Block images/fonts/media for speed

**Authentication & Headers:**
- **`userAgent`** (string): Custom user agent
- **`cookies`** (object): Cookie key-value pairs
- **`headers`** (object): Custom HTTP headers

**Proxy Options:**
- **`proxy`** (string): Proxy URL
- **`proxyUsername`** (string): Proxy authentication username
- **`proxyPassword`** (string): Proxy authentication password
- **`proxyRotation`** (boolean): Enable proxy rotation
- **`proxyList`** (string[]): List of proxy URLs to rotate

**Rate Limiting Options:**
- **`minDelay`** (number): Minimum delay between requests (ms)
- **`maxDelay`** (number): Maximum delay for exponential backoff (ms)
- **`maxRetries`** (number): Maximum retries for failed requests
- **`backoffFactor`** (number): Exponential backoff multiplier
- **`rotateUserAgent`** (boolean): Rotate user agents between requests

**Browser Actions** (`actions` array):
Array of actions to perform on each page:
```javascript
{
  "type": "click|scroll|wait|fill|select",
  "selector": "CSS selector",
  "value": "value for fill/select",
  "position": 1000,  // pixels for scroll
  "timeout": 5000,   // ms for wait
  "optional": true   // don't fail if action fails
}
```

**Caching Options:**
- **`skipCache`** (boolean): Skip cache for this request
- **`cacheTtl`** (number): Custom cache TTL in seconds

#### **Sample API Calls**

**Basic Crawl:**
```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 100,
    "maxDepth": 3
  }'
```

**High-Performance Discovery Crawl with Enhanced Options:**
```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://docs.oracle.com/en-us/iaas/Content/home.htm",
    "useMapDiscovery": true,
    "maxUrls": 5000,
    "timeoutMs": 300000,
    "allowSubdomains": true,
    "includePatterns": ["/en-us/iaas/"],
    "excludePatterns": ["/archive/", "/old/"],
    "crawlOptions": {
      "maxCrawlDepth": 3,
      "maxConcurrentCrawlers": 10,
      "crawlTimeoutPerPage": 5000,
      "enableDeepCrawling": true,
      "browserPoolSize": 8
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "waitForTimeout": 3000,
      "blockAds": true
    }
  }'
```

**Fast Discovery Crawl (Browser-Only, 10x Faster):**
```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://firecrawl.dev",
    "useMapDiscovery": true,
    "maxUrls": 100,
    "timeoutMs": 30000,
    "skipSitemaps": true,
    "includePatterns": ["/blog/", "/docs/"],
    "crawlOptions": {
      "maxCrawlDepth": 2,
      "maxConcurrentCrawlers": 5,
      "enableDeepCrawling": true
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "useBrowser": true,
      "stealthMode": true
    }
  }'
```

**Conservative Discovery Crawl (Rate-Limited):**
```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://docs.github.com",
    "useMapDiscovery": true,
    "maxUrls": 500,
    "timeoutMs": 120000,
    "includePatterns": ["/api/", "/guides/"],
    "crawlOptions": {
      "maxCrawlDepth": 2,
      "maxConcurrentCrawlers": 2,
      "crawlTimeoutPerPage": 8000,
      "enableDeepCrawling": false
    },
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "minDelay": 2000,
      "maxRetries": 3
    }
  }'
```

**Advanced Browser Crawl with Actions:**
```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://spa-app.com",
    "limit": 200,
    "useBrowser": true,
    "strategy": "bfs",
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "javascript": true,
      "stealthMode": true,
      "actions": [
        {"type": "wait", "timeout": 2000},
        {"type": "scroll", "position": 1000},
        {"type": "click", "selector": ".load-more", "optional": true}
      ]
    }
  }'
```

**Filtered Crawl with Rate Limiting:**
```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://blog.example.com",
    "limit": 1000,
    "includePaths": ["/posts/", "/articles/"],
    "excludePaths": ["/admin/", "/login/"],
    "allowSubdomains": false,
    "scrapeOptions": {
      "extractorFormat": "markdown",
      "minDelay": 1000,
      "maxRetries": 3,
      "userAgent": "Custom Bot 1.0"
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
| `/api/map` | POST | **Discover URLs (High-Performance)** |
| `/api/map/cache/stats` | GET | Get URL discovery cache stats |
| `/api/map/cache/clear` | POST | Clear URL discovery cache |
| `/api/map/health` | GET | Map service health check |
| `/api/batch/scrape` | POST | Start batch processing |
| `/api/batch/scrape/:id/status` | GET | Get batch status |
| `/api/batch/scrape/:id/download/zip` | GET | Download batch as ZIP |
| `/api/batch/scrape/:id/download/json` | GET | Download batch as JSON |
| `/api/batch/scrape/:id/download/:jobId` | GET | Download individual result |
| `/api/batch/scrape/:id` | DELETE | Cancel batch processing |
| `/api/crawl` | POST | Start web crawl (supports `useMapDiscovery: true` for 60x faster discovery) |
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

### Crawler Options

```typescript
interface CrawlRequest {
  url: string
  includePaths?: string[]
  excludePaths?: string[]
  limit?: number                    // Default: 100
  maxDepth?: number                 // Default: 5
  allowBackwardCrawling?: boolean
  allowExternalContentLinks?: boolean
  allowSubdomains?: boolean
  ignoreRobotsTxt?: boolean
  regexOnFullURL?: boolean
  scrapeOptions?: ScraperOptions
  webhook?: string
  strategy?: 'bfs' | 'dfs' | 'best_first'
  useBrowser?: boolean
  useMapDiscovery?: boolean         // 🆕 Enable 60x faster URL discovery
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

## 🔄 Combining URL Discovery with Scraping

The `/api/map` endpoint works seamlessly with existing scraping workflows for maximum efficiency:

### 1. Discovery + Batch Scraping
```bash
# Step 1: Discover URLs (fast)
URLS=$(curl -s -X POST http://localhost:3000/api/map \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://docs.example.com", "maxUrls": 100}' | \
  jq -r '.data.links[]')

# Step 2: Batch scrape discovered URLs
curl -X POST http://localhost:3000/api/batch/scrape \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d "{\"urls\": $(echo $URLS | jq -R -s -c 'split(\"\n\")[:-1]')}"
```

### 2. Discovery + Targeted Crawling
```bash
# Use discovery to set optimal crawl limits
curl -X POST http://localhost:3000/api/map \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "includePatterns": ["api", "guides"],
    "maxUrls": 500
  }' | jq '.data.total'  # Returns actual discoverable count

# Then crawl with appropriate limit
curl -X POST http://localhost:3000/api/crawl \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 500,
    "includePaths": ["^/api/.*", "^/guides/.*"]
  }'
```

### 3. Endpoint Comparison & Expected Outputs

| Endpoint | Purpose | Output | Performance | Use Case |
|----------|---------|---------|-------------|----------|
| **`/api/map`** | URL Discovery Only | **List of URLs** (no content) | 5,000+ URLs in 2-3 seconds | Find URLs before scraping |
| **`/api/crawl`** | Crawl + Scrape | **Scraped content files** | 100 URLs in 2-5 minutes | Traditional approach |
| **`/api/crawl` + `useMapDiscovery`** | **Enhanced Discovery + Scraping** | **Scraped content files** | **1,000+ URLs in 30-60 seconds** | **🚀 Recommended approach** |
| **`/api/batch/scrape`** | Parallel scraping | **Scraped content files** | Any number of URLs | Scrape known URL lists |

### 4. Expected Outputs

**`/api/map` Output** (URLs only):
```json
{
  "success": true,
  "data": {
    "links": [
      "https://docs.example.com/api/auth",
      "https://docs.example.com/api/users",
      "https://docs.example.com/guides/quickstart"
    ],
    "total": 1247,
    "timeTaken": 2340
  }
}
```

**`/api/crawl` Output** (Scraped files):
```json
{
  "success": true,
  "status": "completed",
  "exportedFiles": {
    "count": 15,
    "outputDirectory": "./crawl-output/abc123-def456",
    "files": [
      "./crawl-output/abc123-def456/2024-01-15_abc123_example.com_api-auth.md",
      "./crawl-output/abc123-def456/2024-01-15_abc123_example.com_api-users.md"
    ]
  }
}
```

### 5. Performance Comparison

| Workflow | Discovery + Scraping | Total URLs | Success Rate | Architecture |
|----------|---------------------|------------|--------------|--------------|
| **Traditional Crawl** | 2-5 minutes | 100 URLs | 85% (limited by timeouts) | Sequential |
| **Enhanced Discovery Crawl** | **30-60 seconds** | **1,000+ URLs** | **95%+ (comprehensive)** | **🚀 Map Discovery + Scraping** |
| **Map + Batch** | 2-3 seconds discovery + batch time | 30,000 URLs | 98% (parallel processing) | Hybrid |

## Advanced Features

### 🏊 Browser Pool Management

DeepScraper automatically manages a pool of reusable browser instances for optimal performance:

```typescript
// Automatic browser pool management (5 browsers by default)
// No configuration needed - works automatically with streaming crawls
```

**Browser Pool Benefits**:
- **90% faster page loading** (reuse vs new browser creation: ~100ms vs 2-3 seconds)
- **Memory efficient** (controlled browser lifecycle with automatic cleanup)
- **Context isolation** (each request gets isolated browser context)
- **Automatic scaling** (pool grows/shrinks based on demand)

**Pool Statistics** (available via internal monitoring):
```json
{
  "totalBrowsers": 5,
  "activeBrowsers": 3,
  "poolUtilization": 0.6,
  "activePages": 12
}
```

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
- [x] 🗺️ High-performance URL discovery (`/map` endpoint)
- [ ] 🔍 Search engine API integrations (Google, Bing, DuckDuckGo)
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