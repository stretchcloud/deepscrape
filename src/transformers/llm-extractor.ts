import { ScraperResponse } from '../types';
import { OpenAIService } from '../services/openai.service';
import {
  ExtractionOptions,
  ExtractionResult,
  Schema
} from '../types/schema';
import { logger } from '../utils/logger';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { chunkText, estimateTokens } from './chunker';
import { scoreExtraction } from './confidence-scorer';

// Shared Ajv instance for validating LLM extraction output against user schemas.
const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });
addFormats(ajv);

/** Compile+validate `data` against a JSON schema; returns errors (empty if valid). */
function validateAgainstSchema(schema: unknown, data: unknown): string[] {
  try {
    const validate: ValidateFunction = ajv.compile(schema as object);
    if (validate(data)) return [];
    return (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`);
  } catch (err) {
    // A schema we can't compile shouldn't hard-fail extraction; log and pass.
    logger.warn(`Could not compile extraction schema for validation: ${(err as Error).message}`);
    return [];
  }
}

export class LLMExtractor {
  private llmService: OpenAIService;

  constructor(llmService: OpenAIService) {
    this.llmService = llmService;
  }

  /**
   * Extract structured data using LLM
   */
  async extract<T>(
    scraperResponse: ScraperResponse,
    options: ExtractionOptions
  ): Promise<ScraperResponse & { structuredData?: T; extractionResult?: ExtractionResult<T> }> {
    try {
      const startTime = Date.now();
      logger.info(`Starting LLM extraction for URL: ${scraperResponse.url}`);

      // Get content to analyze
      const content = scraperResponse.content;
      if (!content) {
        logger.warn('Content is empty, skipping extraction');
        return {
          ...scraperResponse,
          extractionResult: {
            success: false,
            error: 'Content is empty'
          }
        };
      }

      // Token-aware chunking: instead of silently truncating long pages at 15k
      // chars, split into token-budgeted chunks (with overlap), extract from
      // each, and merge. Small pages are a single chunk (no behavior change).
      const budgetTokens = Number(process.env.MAX_EXTRACTION_TOKENS ?? 15000);
      const chunks = estimateTokens(content) <= budgetTokens
        ? [content]
        : chunkText(content, { maxTokens: budgetTokens, overlapRate: 0.1 });

      logger.info(`LLM extraction over ${chunks.length} chunk(s) for URL: ${scraperResponse.url}`);

      const partials: any[] = [];
      let lastError: string | undefined;
      for (const chunk of chunks) {
        const r = await this.callLlmOnce<T>(chunk, scraperResponse.title, scraperResponse.url, options);
        if (r.success) {
          partials.push(r.data);
        } else {
          lastError = r.error;
        }
      }

      const extractionTime = Date.now() - startTime;

      if (partials.length === 0) {
        logger.error(`LLM extraction failed: ${lastError}`);
        return {
          ...scraperResponse,
          extractionResult: { success: false, error: lastError ?? 'LLM extraction failed', metadata: { extractionTime } }
        };
      }

      // Merge chunk results (concat arrays, fill/union objects, join text).
      const merged = this.mergeExtractions(partials, options);

      // Validate the MERGED result against the schema, if one was supplied.
      if (options.schema) {
        const validationErrors = validateAgainstSchema(options.schema, merged);
        if (validationErrors.length > 0) {
          logger.warn(`LLM output failed schema validation: ${validationErrors.slice(0, 5).join('; ')}`);
          return {
            ...scraperResponse,
            extractionResult: {
              success: false,
              error: `Extracted data did not match the requested schema: ${validationErrors.slice(0, 5).join('; ')}`,
              data: merged,
              metadata: { extractionTime }
            }
          };
        }
      }

      // Deterministic confidence: ground each extracted field against the source
      // so hallucinated (not-in-source) and omitted (empty) fields are flagged.
      const confidence = scoreExtraction(merged, content);
      if (confidence.suspect.length > 0) {
        logger.warn(`LLM extraction: ${confidence.suspect.length} field(s) not grounded in source (possible hallucination): ${confidence.suspect.join(', ')}`);
      }

      logger.info(`LLM extraction completed successfully in ${extractionTime}ms (${chunks.length} chunk(s)), confidence ${confidence.overall}`);
      return {
        ...scraperResponse,
        structuredData: merged,
        extractionResult: {
          success: true,
          data: merged,
          metadata: {
            extractionTime,
            modelName: this.llmService.model || 'gpt-4o',
            confidence
          }
        }
      };
    } catch (error) {
      logger.error(`Error during LLM extraction: ${error instanceof Error ? error.message : String(error)}`);

      return {
        ...scraperResponse,
        extractionResult: {
          success: false,
          error: `LLM extraction error: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }

  /**
   * Run a single LLM extraction call over one chunk of content.
   */
  private async callLlmOnce<T>(
    content: string,
    title: string,
    url: string,
    options: ExtractionOptions
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    const messages = this.createExtractionPrompt(content, title, url, options);
    const responseFormat = options.schema ? { type: 'json_object' } : undefined;
    const llmResponse = await this.llmService.getCompletion<T>(
      messages,
      { temperature: options.temperature || 0.2, maxTokens: options.maxTokens || 4000 },
      responseFormat
    );
    return { success: llmResponse.success, data: llmResponse.data, error: llmResponse.error };
  }

  /**
   * Merge per-chunk extraction results into one.
   * - Single chunk: returned as-is.
   * - Summaries / QA (strings): concatenated.
   * - Arrays: concatenated (e.g. lists of items across chunks).
   * - Objects: unioned — the first non-empty value for each key wins; array-valued
   *   fields are concatenated.
   */
  private mergeExtractions(partials: any[], options: ExtractionOptions): any {
    if (partials.length === 1) return partials[0];

    // Text results (summary/qa) -> join.
    if (partials.every(p => typeof p === 'string')) {
      return partials.join('\n\n');
    }

    // Array results -> concat.
    if (partials.every(p => Array.isArray(p))) {
      return ([] as any[]).concat(...partials);
    }

    // Object results -> union fields.
    if (partials.every(p => p && typeof p === 'object' && !Array.isArray(p))) {
      const merged: Record<string, any> = {};
      for (const part of partials) {
        for (const [key, value] of Object.entries(part)) {
          const existing = merged[key];
          if (Array.isArray(existing) && Array.isArray(value)) {
            merged[key] = existing.concat(value);
          } else if (existing === undefined || existing === null || existing === '' ||
                     (Array.isArray(existing) && existing.length === 0)) {
            merged[key] = value;
          }
        }
      }
      return merged;
    }

    // Mixed shapes -> return the first successful partial.
    return partials[0];
  }

  /**
   * Create an extraction prompt based on options
   */
  private createExtractionPrompt(
    content: string,
    title: string,
    url: string,
    options: ExtractionOptions
  ): Array<{ role: string; content: string }> {
    const { schema, instructions, extractionType = 'structured', promptFormat = 'zero-shot' } = options;

    const messages: Array<{ role: string; content: string }> = [];

    // System message defines the task
    let systemMessage = 'You are an expert web content analyzer and data extractor. ';

    if (extractionType === 'structured' && schema) {
      systemMessage += 'Extract structured data from the content based on the provided schema and output as JSON. ';
      systemMessage += 'Be precise and follow the schema exactly. If information is not available, use null or empty values.';
    } else if (extractionType === 'summary') {
      systemMessage += 'Create a concise summary of the main points in the provided content.';
    } else if (extractionType === 'qa') {
      systemMessage += 'Answer questions about the provided content accurately and concisely.';
    }

    messages.push({ role: 'system', content: systemMessage });

    // If few-shot prompting is used and example data is provided
    if (promptFormat === 'few-shot' && options.exampleData) {
      messages.push({
        role: 'user',
        content: 'Here is an example of the extraction format I want:\n' +
          JSON.stringify(options.exampleData, null, 2)
      });

      messages.push({
        role: 'assistant',
        content: 'I understand. I will extract information in that format.'
      });
    }

    // Construct the main user message with the content
    let userMessage = `I need to extract information from the following web content from ${url}`;

    if (title) {
      userMessage += ` with title "${title}"`;
    }

    // Add JSON reference for schema extractions
    if (schema) {
      userMessage += ' and return it as JSON';
    }

    userMessage += ':\n\n';
    userMessage += content;

    // Add schema details if available
    if (schema) {
      userMessage += '\n\nPlease extract information using this JSON schema:\n';
      userMessage += JSON.stringify(schema, null, 2);
    }

    // Add custom instructions if provided
    if (instructions) {
      userMessage += `\n\nAdditional instructions: ${instructions}`;

      // Ensure JSON is mentioned in the instructions if using a schema
      if (schema && !instructions.toLowerCase().includes('json')) {
        userMessage += ' and format as JSON';
      }
    } else if (schema) {
      // If no instructions provided but using schema, add a default JSON instruction
      userMessage += '\n\nAdditional instructions: Extract the information and format as JSON';
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
  }
}
