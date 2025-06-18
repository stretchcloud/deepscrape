import { ScraperResponse } from '../types';
import { OpenAIService } from '../services/openai.service';
import { 
  ExtractionOptions, 
  ExtractionResult, 
  Schema
} from '../types/schema';
import { logger } from '../utils/logger';

/**
 * Limit token size to prevent exceeding model limits
 * @param text The text to limit
 * @param maxTokens Maximum number of tokens
 */
function limitTextSize(text: string, maxTokens = 15000): string {
  // Simple approximation: 1 token ≈ 4 characters for English text
  const maxCharacters = maxTokens * 4;
  
  if (text.length <= maxCharacters) {
    return text;
  }
  
  // If text is too long, cut it and add a note
  return text.substring(0, maxCharacters) + 
    "\n\n[Note: Content was truncated due to length limitations.]";
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
      
      // Limit content size to prevent token limit issues
      const limitedContent = limitTextSize(content, 15000);
      
      // Format extraction prompt based on extraction type
      const messages = this.createExtractionPrompt(
        limitedContent, 
        scraperResponse.title,
        scraperResponse.url,
        options
      );
      
      // Configure response format as JSON if a schema is provided
      const responseFormat = options.schema 
        ? { type: 'json_object' } 
        : undefined;
      
      // Make the LLM API call
      const llmResponse = await this.llmService.getCompletion<T>(
        messages,
        {
          temperature: options.temperature || 0.2,
          maxTokens: options.maxTokens || 4000
        },
        responseFormat
      );
      
      const extractionTime = Date.now() - startTime;
      
      if (!llmResponse.success) {
        logger.error(`LLM extraction failed: ${llmResponse.error}`);
        return {
          ...scraperResponse,
          extractionResult: {
            success: false,
            error: llmResponse.error,
            metadata: {
              extractionTime
            }
          }
        };
      }
      
      // Add the structured data to the response
      logger.info(`LLM extraction completed successfully in ${extractionTime}ms`);
      return {
        ...scraperResponse,
        structuredData: llmResponse.data,
        extractionResult: {
          success: true,
          data: llmResponse.data,
          metadata: {
            extractionTime,
            modelName: this.llmService.model || 'gpt-4o'
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