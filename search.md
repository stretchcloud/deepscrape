# 🔍 DeepScraper Search API Implementation Guide

## Overview

This document outlines the implementation plan for adding a search API endpoint to DeepScraper. The search API will allow users to search the web and optionally scrape the results using DeepScraper's existing powerful scraping and extraction capabilities.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   API Client    │────▶│ Search Controller│────▶│ Search Service  │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                          │
                                ┌─────────────────────────┴─────────────────┐
                                │                                           │
                        ┌───────▼────────┐  ┌──────────────┐  ┌───────────▼────────┐
                        │ Serper Provider│  │SearchAPI     │  │ Google Provider    │
                        │   (Primary)    │  │  Provider    │  │   (Fallback)      │
                        └────────────────┘  └──────────────┘  └────────────────────┘
                                                          │
                                                  ┌───────▼────────┐
                                                  │ Scraper Manager │
                                                  │ (if requested)  │
                                                  └────────────────┘
```

## Implementation Plan

### 1. Create Search Service Module

#### Directory Structure
```
src/services/search/
├── search.service.ts       # Main search orchestrator
├── providers/
│   ├── base.provider.ts    # Abstract base class
│   ├── serper.provider.ts  # Serper.dev integration
│   ├── searchapi.provider.ts # SearchAPI.io integration
│   ├── google.provider.ts  # Direct Google scraping
│   └── duckduckgo.provider.ts # DuckDuckGo (optional)
└── index.ts
```

#### Base Provider Interface
```typescript
// src/services/search/providers/base.provider.ts
export interface SearchResult {
  url: string;
  title: string;
  description: string;
  position?: number;
}

export interface SearchOptions {
  num_results: number;
  tbs?: string;        // Time-based search
  filter?: string;     // Search filters
  lang?: string;       // Language
  country?: string;    // Country code
  location?: string;   // Specific location
}

export abstract class SearchProvider {
  abstract name: string;
  abstract search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}
```

### 2. Search Controller

```typescript
// src/api/controllers/search.controller.ts
import { Request, Response } from 'express';
import { SearchService } from '../../services/search/search.service';
import { ScraperManager } from '../../scraper/scraper-manager';
import { logger } from '../../utils/logger';

export class SearchController {
  private searchService: SearchService;
  private scraperManager: ScraperManager;

  constructor() {
    this.searchService = new SearchService();
    this.scraperManager = ScraperManager.getInstance();
  }

  async search(req: Request, res: Response) {
    const startTime = Date.now();
    const {
      query,
      limit = 10,
      scrapeOptions,
      tbs,
      filter,
      lang = 'en',
      country = 'us',
      location,
      timeout = 60000,
      ignoreInvalidURLs = false
    } = req.body;

    try {
      // Step 1: Get search results
      const searchResults = await this.searchService.search(query, {
        num_results: limit,
        tbs,
        filter,
        lang,
        country,
        location
      });

      // Step 2: Filter invalid URLs if requested
      let filteredResults = searchResults;
      if (ignoreInvalidURLs) {
        filteredResults = searchResults.filter(result => 
          this.isValidUrl(result.url)
        );
      }

      // Step 3: If no scrapeOptions, return search results only
      if (!scrapeOptions || !scrapeOptions.formats?.length) {
        return res.json({
          success: true,
          data: filteredResults
        });
      }

      // Step 4: Scrape each search result
      const scrapedResults = await this.scrapeSearchResults(
        filteredResults,
        scrapeOptions,
        timeout
      );

      const processingTime = Date.now() - startTime;

      return res.json({
        success: true,
        data: scrapedResults,
        metadata: {
          query,
          totalResults: scrapedResults.length,
          processingTime
        }
      });

    } catch (error) {
      logger.error('Search API error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  private async scrapeSearchResults(
    results: SearchResult[],
    scrapeOptions: any,
    timeout: number
  ) {
    const scrapePromises = results.map(async (result) => {
      try {
        const scrapedData = await this.scraperManager.scrape(
          result.url,
          scrapeOptions
        );
        return {
          ...result,
          ...scrapedData
        };
      } catch (error) {
        logger.warn(`Failed to scrape ${result.url}:`, error);
        return {
          ...result,
          error: error.message
        };
      }
    });

    return Promise.all(scrapePromises);
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
```

### 3. Types and Schemas

```typescript
// src/types/search.ts
import { z } from 'zod';
import { scraperOptionsSchema } from './index';

export const searchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(100).optional().default(10),
  scrapeOptions: scraperOptionsSchema.optional(),
  tbs: z.string().optional(), // Time-based search (e.g., 'qdr:d' for past day)
  filter: z.string().optional(),
  lang: z.string().length(2).optional().default('en'),
  country: z.string().length(2).optional().default('us'),
  location: z.string().optional(),
  timeout: z.number().int().min(1000).max(300000).optional().default(60000),
  ignoreInvalidURLs: z.boolean().optional().default(false)
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export interface SearchResult {
  url: string;
  title: string;
  description: string;
  position?: number;
}

export interface SearchResponse {
  success: boolean;
  data: Document[] | SearchResult[];
  warning?: string;
  metadata?: {
    query: string;
    totalResults: number;
    processingTime: number;
  };
}
```

### 4. Search Routes

```typescript
// src/api/routes/search.routes.ts
import { Router } from 'express';
import { SearchController } from '../controllers/search.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation';
import { searchRequestSchema } from '../../types/search';

const router = Router();
const searchController = new SearchController();

router.post(
  '/search',
  authMiddleware,
  validateRequest(searchRequestSchema),
  (req, res) => searchController.search(req, res)
);

export default router;
```

### 5. Search Service Implementation

```typescript
// src/services/search/search.service.ts
import { SerperProvider } from './providers/serper.provider';
import { SearchAPIProvider } from './providers/searchapi.provider';
import { GoogleProvider } from './providers/google.provider';
import { SearchResult, SearchOptions } from './providers/base.provider';
import { logger } from '../../utils/logger';

export class SearchService {
  private providers: SearchProvider[];

  constructor() {
    this.providers = this.initializeProviders();
  }

  private initializeProviders(): SearchProvider[] {
    const providers: SearchProvider[] = [];

    // Initialize providers based on available API keys
    if (process.env.SERPER_API_KEY) {
      providers.push(new SerperProvider(process.env.SERPER_API_KEY));
    }

    if (process.env.SEARCHAPI_API_KEY) {
      providers.push(new SearchAPIProvider(process.env.SEARCHAPI_API_KEY));
    }

    // Always add Google as fallback
    providers.push(new GoogleProvider());

    return providers;
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    for (const provider of this.providers) {
      try {
        logger.info(`Attempting search with ${provider.name}`);
        const results = await provider.search(query, options);
        
        if (results.length > 0) {
          logger.info(`${provider.name} returned ${results.length} results`);
          return results;
        }
      } catch (error) {
        logger.warn(`${provider.name} search failed:`, error);
        // Continue to next provider
      }
    }

    logger.error('All search providers failed');
    throw new Error('Search failed: All providers returned no results');
  }
}
```

### 6. Provider Implementations

#### Serper Provider Example
```typescript
// src/services/search/providers/serper.provider.ts
import axios from 'axios';
import { SearchProvider, SearchResult, SearchOptions } from './base.provider';

export class SerperProvider extends SearchProvider {
  name = 'Serper';
  
  constructor(private apiKey: string) {
    super();
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const response = await axios.post(
      'https://google.serper.dev/search',
      {
        q: query,
        num: options.num_results,
        hl: options.lang,
        gl: options.country,
        location: options.location,
        tbs: options.tbs
      },
      {
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data?.organic) {
      return response.data.organic.map((result: any, index: number) => ({
        url: result.link,
        title: result.title,
        description: result.snippet,
        position: index + 1
      }));
    }

    return [];
  }
}
```

### 7. Environment Configuration

Add to `.env.example`:
```env
# Search API Configuration
# Serper.dev API key (https://serper.dev)
SERPER_API_KEY=

# SearchAPI.io API key (https://www.searchapi.io)
SEARCHAPI_API_KEY=

# Search configuration
SEARCH_DEFAULT_PROVIDER=serper
SEARCH_MAX_RESULTS=100
SEARCH_SCRAPE_CONCURRENCY=5
SEARCH_CACHE_TTL=3600

# Rate limiting for search endpoint
SEARCH_RATE_LIMIT_REQUESTS=100
SEARCH_RATE_LIMIT_WINDOW=900000
```

### 8. Integration with Main App

Update `src/index.ts`:
```typescript
import searchRoutes from './api/routes/search.routes';

// Add search routes
app.use('/api', searchRoutes);
```

## API Usage Examples

### Basic Search (Results Only)
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "query": "web scraping best practices",
    "limit": 10
  }'
```

### Search with Scraping
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "query": "AI news 2024",
    "limit": 5,
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    }
  }'
```

### Advanced Search with Filters
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "query": "machine learning tutorials",
    "limit": 20,
    "tbs": "qdr:w",  // Past week
    "lang": "en",
    "country": "us",
    "scrapeOptions": {
      "formats": ["markdown", "html"],
      "waitForSelector": ".content",
      "extractSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "author": { "type": "string" },
          "date": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }'
```

## Testing Strategy

### Unit Tests
```typescript
// src/__tests__/services/search/search.service.test.ts
describe('SearchService', () => {
  it('should return results from first available provider', async () => {
    // Mock providers and test fallback mechanism
  });

  it('should handle provider failures gracefully', async () => {
    // Test error handling and fallback
  });
});
```

### Integration Tests
```typescript
// src/__tests__/api/search.test.ts
describe('Search API', () => {
  it('should return search results without scraping', async () => {
    // Test basic search functionality
  });

  it('should scrape search results when requested', async () => {
    // Test search + scrape functionality
  });

  it('should validate request parameters', async () => {
    // Test input validation
  });
});
```

## Performance Considerations

1. **Caching**: Implement Redis caching for search results
2. **Rate Limiting**: Apply rate limits per API key
3. **Concurrent Scraping**: Use worker pool for scraping multiple results
4. **Timeout Handling**: Implement proper timeouts for each provider
5. **Result Deduplication**: Remove duplicate URLs from results

## Security Considerations

1. **Input Sanitization**: Sanitize search queries to prevent injection
2. **URL Validation**: Validate URLs before scraping
3. **API Key Management**: Secure storage of provider API keys
4. **Rate Limiting**: Prevent abuse of search endpoints
5. **Content Filtering**: Option to filter adult/malicious content

## Future Enhancements

1. **Additional Search Providers**
   - Bing Search API
   - DuckDuckGo API
   - Brave Search API
   - Yandex Search API

2. **Advanced Features**
   - Search result caching with TTL
   - Search analytics and tracking
   - Custom ranking algorithms
   - Image and video search support
   - News-specific search
   - Academic paper search
   - Social media search

3. **Performance Optimizations**
   - Parallel provider queries
   - Smart provider selection based on query type
   - Result pre-fetching for pagination
   - Adaptive timeout based on provider performance

4. **Enhanced Scraping**
   - Priority-based scraping queue
   - Incremental result streaming
   - Failed URL retry mechanism
   - Screenshot capture for search results

## Implementation Timeline

1. **Week 1**: Core search service and provider framework
2. **Week 2**: Controller, routes, and API integration
3. **Week 3**: Provider implementations (Serper, SearchAPI, Google)
4. **Week 4**: Testing, documentation, and optimization

## Conclusion

This search API implementation will provide DeepScraper with powerful web search capabilities, allowing users to:
- Search the web using multiple providers
- Optionally scrape and extract data from search results
- Apply DeepScraper's existing features (LLM extraction, format conversion)
- Build complex workflows combining search and scraping

The modular design ensures easy addition of new search providers and features in the future.