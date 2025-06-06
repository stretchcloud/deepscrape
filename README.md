# 📚 DeepScrape – Intelligent Web Scraping & LLM-Powered Extraction

[![License: Apache License 2.0](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Build](https://img.shields.io/github/actions/workflow/status/stretchcloud/deepscrape/ci.yml?label=build)](https://github.com/stretchcloud/deepscrape/actions) [![Docker Pulls](https://img.shields.io/docker/pulls/stretchcloud/deepscrape)](https://hub.docker.com/r/stretchcloud/deepscrape)

> **Turn _any_ web page into structured data with Playwright-powered scraping, caching & GPT-4o extraction.**

_DeepScrape_ is an open-source TypeScript framework that couples modern browser automation with OpenAI to deliver high-quality HTML, Markdown, text or JSON—ready for RAG pipelines, analytics or downstream APIs.

---

## 🛠️ Core Technologies

DeepScrape leverages a modern stack to provide robust and intelligent scraping capabilities:

*   **Runtime & Language:** Built with **Node.js** and **TypeScript**, offering type safety and modern JavaScript features.
*   **Scraping Engine:** Primarily uses **Playwright** for high-fidelity browser automation, enabling interaction with dynamic websites (SPAs) and employing stealth techniques. (**Note:** Puppeteer is also listed as a dependency, suggesting potential configurability or legacy support. Cheerio might be used for simpler, static HTML parsing scenarios.)
*   **API Framework:** A **RESTful API** built with **Express.js**, providing endpoints for scraping, extraction, and cache management. Includes standard middleware like **Helmet** (security headers), **Morgan** (request logging), and **CORS** (cross-origin resource sharing).
*   **AI / LLM Integration:** Leverages **OpenAI** services, specifically configured for models like **GPT-4o**, to perform:
    *   **Structured Data Extraction:** Interprets user-provided JSON schemas to extract specific data points from web content.
    *   **Summarization:** Generates concise summaries of page content.
    *   **Token Management:** Uses **Tiktoken** to accurately count tokens for managing LLM context windows and potential costs.
*   **Content Transformation:** Uses **Turndown** to convert scraped HTML content into clean **Markdown**, ideal for LLM ingestion or RAG pipelines.
*   **Job Queueing:** Implements **BullMQ** with **IORedis** as the backend. This allows long-running scraping and extraction tasks to be processed asynchronously in the background, preventing API timeouts and improving scalability.
*   **Data Validation:** Employs **Zod** for robust schema definition and validation, particularly for API request bodies/parameters and potentially for validating LLM output schemas.
*   **Caching:** Features a built-in **file-system based caching** layer with configurable **Time-To-Live (TTL)** to store responses, reducing redundant scraping/LLM calls, saving costs, and improving response times.
*   **Logging:** Utilizes **Winston** for flexible and configurable logging across the application, outputting to files (like `combined.log`, `error.log`) and potentially the console.
*   **Deployment:** Provides **Docker** and **Docker Compose** configurations for easy containerization and deployment to various hosting platforms or local environments.

---

## ✨ Why DeepScrape?

| ⚡ Feature | 📋 Description |
|-----------|---------------|
| **LLM- driven extraction** | Feed any [JSON Schema](https://json-schema.org/) and let GPT-4o return structured JSON.
| **Modern browser automation** | Uses Playwright (or Puppeteer) with stealth & proxy options to bypass bot detection.
| **Markdown & text converters** | Turndown turns messy DOM into clean Markdown for RAG.
| **Caching layer** | Pluggable cache (filesystem by default) to save tokens & latency.
| **Job queue** | BullMQ + Redis handle heavy jobs without blocking the API.
| **API-first** | REST endpoints secured with API keys, documented with Swagger.
| **Docker-ready** | One-command deployment for prod. Works great on Fly, Railway, Render or your own k8s.
| **Apache-2.0-licensed** | Fully open-source and free forever.

---

## 🚀 Quick Start

### 1. Local development

```bash
# Clone & install
git clone https://github.com/stretchcloud/deepscrape.git
cd deepscrape
npm install

# Copy env template & edit values
cp .env.example .env

# Start dev server (TS-Node)
npm run dev
```

Hit `http://localhost:3000/health` and you should see `{ status: 'ok' }`.

### 2. Single-shot scrape

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: test-key" \
  -d '{
    "url": "https://example.com",
    "options": { "extractorFormat": "markdown" }
  }' | jq -r '.content' > content.md
```

### 3. Schema-based extraction

```bash
curl -X POST http://localhost:3000/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: test-key" \
  -d '{
    "url": "https://example.com/article",
    "schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "author": { "type": "string" },
        "content": { "type": "string" }
      },
      "required": ["title", "content"]
    }
  }' | jq -r '.extractedData' > schemadata.md
```

### 4. Docker production image

```bash
docker run -d -p 3000:3000 \
  --name deepscrape \
  --env-file .env \
  your-org/deepscrape:latest
```

---

## 🏗️ Architecture Overview

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

---

## 🛣️ Roadmap

- [ ] 🚸 Browser pooling & warm-up
- [ ] 🧠 Automatic schema generation (LLM)
- [ ] 📊 Prometheus metrics & Grafana dashboard
- [ ] 🌐 Cloud-native cache backends (S3/Redis)
- [ ] 🌈 Web UI playground


---

### **1. Scrape URL Content**

`POST /api/scrape`

Fetches the content of a single URL, processes it, and returns it in the specified format (HTML, Markdown, or Text).

**Authentication:** API Key Required

**Request Body:** `application/json`

```json
{
  "url": "string (URL, required)",
  "options": {
    "waitForSelector": "string (CSS selector, optional)",
    "waitForTimeout": "number (ms, optional)",
    "actions": [
      {
        "type": "'click' | 'scroll' | 'wait' | 'fill' | 'select' (required)",
        "selector": "string (CSS selector, optional)",
        "value": "string (for 'fill'/'select', optional)",
        "position": "number (for 'scroll', optional)",
        "timeout": "number (ms, for 'wait', optional)",
        "optional": "boolean (optional)"
      }
    ],
    "skipCache": "boolean (optional, default: false)",
    "cacheTtl": "number (seconds, optional, default: CACHE_TTL)",
    "extractorFormat": "'html' | 'markdown' | 'text' (optional, default: 'html')"
    // ... plus any other general ScraperOptions from the full list below
  }
}
```

**`options` Details:**

*   `waitForSelector`: Wait until an element matching this selector appears before scraping.
*   `waitForTimeout`: Wait for a fixed time (in ms) after the page loads.
*   `actions`: An array of browser actions to perform before scraping (e.g., click buttons, scroll, fill forms).
*   `skipCache`: If true, bypass the cache and fetch live data.
*   `cacheTtl`: Override the default cache TTL for this specific request.
*   `extractorFormat`: The desired output format for the `content` field.

**Example cURL:**

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-key" \
  -d '{
    "url": "https://example.com",
    "options": {
      "extractorFormat": "markdown",
      "waitForSelector": "#main-content"
    }
  }'
```

**Example Success Response (200 OK):**

```json
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "content": "# Example Domain\n\nThis domain is for use in illustrative examples...",
  "contentType": "markdown",
  "metadata": {
    "timestamp": "2024-08-01T12:00:00.000Z",
    "status": 200,
    "headers": { /* ... response headers ... */ },
    "processingTime": 150,
    "loadTime": 850,
    "fromCache": false
  }
}
```

**Example Error Response (400 Bad Request):**

```json
{
  "success": false,
  "error": "Failed to load URL: net::ERR_NAME_NOT_RESOLVED",
  "url": "https://invalid-url-here.xyz",
  "metadata": {
    "processingTime": 50,
    "fromCache": false
  }
}
```

---

### **2. Extract Structured Data via Schema**

`POST /api/extract-schema`

Scrapes a URL and uses an LLM (GPT-4o) to extract structured data based on a provided JSON schema. See [Core Concepts](#-core-concepts-schema-based-extraction) for details.

**Authentication:** API Key Required

**Request Body:** `application/json`

```json
{
  "url": "string (URL, required)",
  "schema": { /* JSON Schema object, required */ },
  "options": {
    "waitForSelector": "string (CSS selector, optional)",
    "waitForTimeout": "number (ms, optional)",
    "actions": [ /* ... BrowserAction objects ... */ ],
    "skipCache": "boolean (optional, default: false)",
    "cacheTtl": "number (seconds, optional, default: CACHE_TTL)",
    "extractorFormat": "'markdown' | 'text' (optional, default: 'markdown')",
    "temperature": "number (0.0-2.0, optional, default: LLM_TEMPERATURE)",
    "maxTokens": "number (optional, default: MAX_EXTRACTION_TOKENS)",
    "instructions": "string (additional LLM instructions, optional)"
    // ... plus any other general ScraperOptions
  }
}
```

**`options` Details (in addition to `/scrape` options):**

*   `schema`: The JSON schema defining the desired output structure. `description` fields are crucial.
*   `temperature`: LLM sampling temperature. Lower is more deterministic.
*   `maxTokens`: Maximum tokens for the LLM response.
*   `instructions`: Optional extra text to guide the LLM's extraction process.
*   `extractorFormat`: Content format passed to the LLM (Markdown generally preferred).

**Example cURL:**

```bash
curl -X POST http://localhost:3000/api/extract-schema \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-key" \
  -d '{
    "url": "https://some-blog.com/article",
    "schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string", "description": "Article headline" },
        "author": { "type": "string", "description": "Author\'s name" }
      },
      "required": ["title"]
    },
    "options": {
      "temperature": 0.1
    }
  }'
```

**Example Success Response (200 OK):**

```json
{
  "success": true,
  "url": "https://some-blog.com/article",
  "title": "Understanding LLMs",
  "extractedData": {
    "title": "Understanding LLMs",
    "author": "AI Expert"
  },
  "contentType": "markdown",
  "metadata": {
    "timestamp": "2024-08-01T12:05:00.000Z",
    "status": 200,
    "headers": { /* ... */ },
    "processingTime": 3500,
    "loadTime": 900,
    "fromCache": false
    // Potentially includes LLM usage stats if implemented
  }
}
```

---

### **3. Summarize URL Content**

`POST /api/summarize`

Scrapes a URL and uses an LLM (GPT-4o) to generate a concise summary of its content.

**Authentication:** API Key Required

**Request Body:** `application/json`

```json
{
  "url": "string (URL, required)",
  "maxLength": "number (words, optional, default: 500)",
  "options": {
    "waitForSelector": "string (CSS selector, optional)",
    "waitForTimeout": "number (ms, optional)",
    "actions": [ /* ... BrowserAction objects ... */ ],
    "skipCache": "boolean (optional, default: false)",
    "cacheTtl": "number (seconds, optional, default: CACHE_TTL)",
    "extractorFormat": "'markdown' | 'text' (optional, default: 'markdown')",
    "temperature": "number (0.0-2.0, optional, default: 0.3)"
    // ... plus any other general ScraperOptions
  }
}
```

**`options` Details (in addition to `/scrape` options):**

*   `maxLength`: Target length for the summary in words.
*   `temperature`: LLM sampling temperature.
*   `extractorFormat`: Content format passed to the LLM.

**Example cURL:**

```bash
curl -X POST http://localhost:3000/api/summarize \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-key" \
  -d '{
    "url": "https://en.wikipedia.org/wiki/Large_language_model",
    "maxLength": 150
  }'
```

**Example Success Response (200 OK):**

```json
{
  "success": true,
  "url": "https://en.wikipedia.org/wiki/Large_language_model",
  "title": "Large language model - Wikipedia",
  "summary": "A large language model (LLM) is a type of language model notable for its large size, trained on vast amounts of text data using self-supervised learning... (summary continues up to ~150 words)",
  "metadata": {
    "timestamp": "2024-08-01T12:10:00.000Z",
    "status": 200,
    "headers": { /* ... */ },
    "processingTime": 4200,
    "loadTime": 1100,
    "fromCache": false
  }
}
```

---

### **4. Manage Cache**

`DELETE /api/cache`

Clears the entire cache or invalidates the cache entry for a specific URL.

**Authentication:** API Key Required

**Request Body:** `application/json` (Optional)

```json
{
  "url": "string (URL, optional)"
}
```

**Details:**

*   If the request body is empty or `url` is omitted, the **entire cache** will be cleared.
*   If `url` is provided, only the cache entry for that specific URL will be invalidated.

**Example cURL (Invalidate single URL):**

```bash
curl -X DELETE http://localhost:3000/api/cache \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: your-secret-key" \
  -d '{
    "url": "https://example.com"
  }'
```

**Example cURL (Clear entire cache):**

```bash
curl -X DELETE http://localhost:3000/api/cache \
  -H "X-API-KEY: your-secret-key"
```

**Example Success Response (200 OK):**

```json
{
  "success": true,
  "message": "Cache invalidated for URL: https://example.com" 
  // Or: "Entire cache cleared successfully"
}
```

---

### **5. Initiate Web Crawl**

`POST /api/v1/crawl`

Starts a new crawl job based on a starting URL and various discovery options. This endpoint queues a job and returns a job ID for status checking.

**Authentication:** Public (No API key required)

**Request Body:** `application/json`

```json
{
  "url": "string (Starting URL, required)",
  "includePaths": "string[] (Regex patterns for allowed paths)",
  "excludePaths": "string[] (Regex patterns for disallowed paths)",
  "limit": "number (Max URLs to crawl, default: 100)",
  "maxDepth": "number (Max crawl depth, default: 5)",
  "strategy": "'bfs' | 'dfs' | 'best_first' (Crawl strategy, default: 'bfs')",
  "allowBackwardCrawling": "boolean (Allow crawling paths above initial URL, default: false)",
  "allowExternalContentLinks": "boolean (Allow external links, default: false)",
  "allowSubdomains": "boolean (Allow subdomain links, default: false)",
  "ignoreRobotsTxt": "boolean (Ignore robots.txt rules, default: false)",
  "regexOnFullURL": "boolean (Apply regex patterns to full URL rather than just path, default: false)",
  "useBrowser": "boolean (Use Playwright browser automation, default: false)",
  "scrapeOptions": { /* ScraperOptions object applied to each crawled page */ },
  "webhook": "string (Optional URL to notify when crawl completes)"
}
```

**Crawl Strategies Explained:**

* **BFS (Breadth-First Search)**: The default strategy that explores all links at the current depth before moving to the next depth level.
  * **Best for**: General website mapping, ensuring complete coverage of all pages at each depth level.
  * **Advantages**: Finds the shortest path to pages, good for complete site exploration, ideal for sites with a logical hierarchical structure.
  * **When to use**: When you want to thoroughly catalog all pages without going too deep into any particular section first.

* **DFS (Depth-First Search)**: Explores as far as possible along each branch before backtracking.
  * **Best for**: Deep exploration of specific sections, finding detailed content buried within nested categories.
  * **Advantages**: Reaches deep pages quickly, uses less memory than BFS, good for targeted content extraction.
  * **When to use**: When you're interested in specific deep content categories or when scraping sites with deep hierarchies.

* **Best-First**: A heuristic search that prioritizes URLs based on relevance scores.
  * **Best for**: Targeted crawling focused on the most relevant content.
  * **Advantages**: Finds high-value content faster, optimizes crawler resources, better results with limited crawl budgets.
  * **When to use**: When you have specific content targets and want to prioritize the most promising paths.

**Key Crawl Parameters:**

* **maxDepth**: Controls how deep the crawler will go in the site hierarchy. Higher values allow deeper exploration but increase crawl time.
  * A reasonable value is 3-5 for general crawling.
  * Lower values (1-2) for quick site scanning.
  * Higher values (6+) for thorough deep crawls.

* **limit**: Sets the maximum number of URLs to crawl.
  * Acts as a safety limit to prevent unbounded crawling.
  * Adjust based on your processing capacity and site size.

* **allowBackwardCrawling**: When true, allows the crawler to navigate to pages in parent directories of the initial URL.
  * Important for exploring full sites when starting from a subdirectory.

* **allowExternalContentLinks**: When true, permits crawling links outside the original domain.
  * Use with caution as this can significantly expand the crawl scope.

* **regexOnFullURL**: When true, applies include/exclude patterns to the entire URL rather than just the path.
  * Provides more precise control over URL filtering.

* **useBrowser**: When true, uses a full browser (Playwright) for crawling instead of simple HTTP requests.
  * Essential for JavaScript-heavy sites where content is rendered client-side.
  * Slower but provides more accurate representation of what users actually see.

**Example cURL:**

```bash
curl -X POST http://localhost:3000/api/v1/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "maxDepth": 2,
    "limit": 10,
    "strategy": "bfs",
    "includePaths": ["^/docs/.*"],
    "scrapeOptions": {
      "extractorFormat": "text"
    }
  }'
```

**Example Success Response (202 Accepted):**

```json
{
  "success": true,
  "id": "12345678-90ab-cdef-1234-567890abcdef",
  "url": "http://localhost:3000/api/v1/crawl/12345678-90ab-cdef-1234-567890abcdef"
}
```

---

### **6. Get Crawl Job Status**

`GET /api/v1/crawl/:jobId`

Retrieves the current status and progress of a specific crawl job initiated via `POST /api/v1/crawl`.

**Authentication:** Public (Potentially?)

**URL Parameters:**

*   `jobId`: The ID returned when the crawl job was created.

**Example cURL:**

```bash
curl http://localhost:3000/api/v1/crawl/bull:yourQueueName:some-unique-id
```

**Example Success Response (200 OK):**

```json
{
  "jobId": "bull:yourQueueName:some-unique-id",
  "status": "active", // or 'completed', 'failed', 'waiting', 'delayed'
  "progress": {
    "processed": 5,
    "total": 10,
    "currentUrl": "https://docs.example.com/page/5"
  },
  "startTime": 1678886400000,
  "endTime": null, // or timestamp if completed/failed
  "results": [ /* Potentially partial results or pointer */ ],
  "error": null // or error message if failed
}
```

---

### **7. Cancel Crawl Job**

`DELETE /api/v1/crawl/:jobId`

Attempts to cancel an active or waiting crawl job.

**Authentication:** Public (Potentially?)

**URL Parameters:**

*   `jobId`: The ID of the crawl job to cancel.

**Example cURL:**

```bash
curl -X DELETE http://localhost:3000/api/v1/crawl/bull:yourQueueName:some-unique-id
```

**Example Success Response (200 OK):**

```json
{
  "message": "Crawl job cancellation requested successfully",
  "jobId": "bull:yourQueueName:some-unique-id"
}
```

**Example Error Response (404 Not Found):**

```json
{
  "error": "Job not found or already completed/failed",
  "jobId": "bull:yourQueueName:invalid-id"
}
```

---

## ⚙️ Configuration

Configure DeepScrape using environment variables. Create a `.env` file in the project root or set these variables in your deployment environment.

```ini
# --- Core Settings ---
API_KEY=your-secret-key          # A secret key clients must provide in the X-API-KEY header.
PORT=3000                        # Port the Express API server will listen on.

# --- OpenAI (Required for AI features) ---
OPENAI_API_KEY=...         # Your OpenAI API key.
OPENAI_ENDPOINT=...        # Your OpenAI resource endpoint (e.g., https://your-resource.openai.com/).
OPENAI_API_VERSION=2023-05-15 # API version for OpenAI.
OPENAI_DEPLOYMENT_NAME=gpt4o # The deployment name of your GPT-4o (or compatible) model.

# --- Caching ---
CACHE_ENABLED=true               # Enable or disable caching (boolean). Set to false for debugging.
CACHE_TTL=3600                   # Default cache Time-To-Live in seconds (1 hour = 3600).
CACHE_DIRECTORY=./cache          # Directory to store filesystem cache files.

# --- LLM Behaviour ---
MAX_EXTRACTION_TOKENS=15000      # Maximum tokens allowed for the combined prompt + expected response during LLM extraction.
LLM_TEMPERATURE=0.2              # Sampling temperature for LLM generation (0.0-2.0). Lower values (e.g., 0.2) make output more deterministic.

# --- Job Queue (Redis) ---
REDIS_HOST=localhost             # Redis server hostname.
REDIS_PORT=6379                  # Redis server port.
REDIS_PASSWORD=                  # Redis password (if any).
```

> **Tip:** set `CACHE_ENABLED=false` while debugging to always hit the live scraper and LLM.

---

## 🧠 Core Concepts: Schema-Based Extraction

The `/api/extract-schema` endpoint is one of DeepScrape's most powerful features. It allows you to transform unstructured web content into structured JSON data using Large Language Models (LLMs) like GPT-4o.

**How it Works:**

1.  **You Provide a Schema:** You send a standard [JSON Schema](https://json-schema.org/) object in your API request. This schema defines the desired structure of your output JSON. Crucially, the `description` fields within your schema properties are used to guide the LLM.
2.  **Scraping:** DeepScrape fetches and cleans the content of the target URL (usually converting it to Markdown).
3.  **LLM Prompting:** A carefully crafted prompt is sent to the configured OpenAI model. This prompt includes:
    *   The cleaned web page content (e.g., Markdown).
    *   Your JSON Schema.
    *   Instructions telling the LLM to extract information matching the schema's properties and descriptions from the provided content, and to format the output strictly as JSON conforming to the schema.
4.  **JSON Parsing & Validation:** The LLM's raw JSON response is parsed and optionally validated against your provided schema (though strict validation depends on the implementation).

**Example:**

If you provide this schema for a blog post URL:

```json
{
  "type": "object",
  "properties": {
    "articleTitle": {
      "type": "string",
      "description": "The main headline or title of the blog post"
    },
    "authorName": {
      "type": "string",
      "description": "The name of the person who wrote the article"
    },
    "publicationDate": {
      "type": "string",
      "description": "The date the article was published (YYYY-MM-DD format)"
    }
  },
  "required": ["articleTitle"]
}
```

The LLM will read the page content and attempt to find the title, author, and publication date based on the descriptions, returning a JSON object like:

```json
{
  "articleTitle": "Understanding Schema Extraction",
  "authorName": "Jane Doe",
  "publicationDate": "2024-07-31"
}
```

**Tips & Limitations:**

*   **Clear Descriptions:** Write clear, unambiguous `description` fields in your schema. This is the primary way you instruct the LLM on *what* data to extract for each field.
*   **Context Window:** Very long web pages might exceed the LLM's context window (`MAX_EXTRACTION_TOKENS`). The scraper might truncate or chunk content, potentially leading to incomplete extractions.
*   **LLM Hallucinations:** LLMs can occasionally make mistakes ("hallucinate") and return incorrect data or fail to find data that *is* present. Experiment with `LLM_TEMPERATURE` (lower values reduce randomness).
*   **Complex Layouts:** Websites with unusual structures, heavy client-side rendering (without sufficient `waitForSelector` or `actions`), or anti-scraping measures can hinder both the scraping and extraction steps.
*   **Schema Complexity:** Overly complex or deeply nested schemas might be harder for the LLM to follow accurately.

---

## 🧩 Scraper Options (TL;DR)

Below is a compressed view—see the [full options table](#scraper-options-reference) for details.

```ts
interface ScraperOptions {
  userAgent?: string;
  timeout?: number;
  javascript?: boolean;
  waitForSelector?: string;
  actions?: BrowserAction[];   // click/scroll etc.
  extractorFormat?: 'html' | 'markdown' | 'text';
  skipCache?: boolean;
  cacheTtl?: number;
  proxy?: string;
  stealthMode?: boolean;
}
```

---

## 🔬 Examples

The `src/examples`

## ⭐ Stargazers

If you find DeepScrape useful, please give us a ⭐ on GitHub—it helps others discover the project!
