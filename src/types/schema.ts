/**
 * Types for schema-based extraction
 */

export type SchemaPropertyType = 
  | 'string' 
  | 'number' 
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

export interface SchemaProperty {
  type: SchemaPropertyType | SchemaPropertyType[];
  description?: string;
  required?: boolean;
  format?: string;
  pattern?: string;
  enum?: any[];
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  additionalProperties?: boolean | SchemaProperty;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: any;
}

export interface Schema {
  type: SchemaPropertyType;
  title?: string;
  description?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Options for LLM extraction
 */
export interface ExtractionOptions {
  temperature?: number;
  maxTokens?: number;
  schema?: Schema;
  instructions?: string;
  extractionType?: 'structured' | 'summary' | 'qa';
  promptFormat?: 'zero-shot' | 'few-shot';
  exampleData?: any;
}

/**
 * Result of LLM extraction
 */
export interface ExtractionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    confidenceScore?: number;
    extractionTime?: number;
    modelName?: string;
  };
}

/**
 * Example schemas for common extraction tasks
 */
export const ExampleSchemas = {
  article: {
    type: 'object',
    title: 'Article',
    description: 'Extract article content and metadata',
    properties: {
      title: {
        type: 'string',
        description: 'The title of the article'
      },
      author: {
        type: 'string',
        description: 'The author of the article'
      },
      publishedDate: {
        type: 'string',
        description: 'The publication date of the article'
      },
      summary: {
        type: 'string',
        description: 'A brief summary of the article content'
      },
      content: {
        type: 'string',
        description: 'The main content of the article'
      },
      topics: {
        type: 'array',
        description: 'Main topics discussed in the article',
        items: {
          type: 'string'
        }
      }
    },
    required: ['title', 'content']
  },
  
  product: {
    type: 'object',
    title: 'Product',
    description: 'Extract product information from a product page',
    properties: {
      name: {
        type: 'string',
        description: 'The name of the product'
      },
      price: {
        type: 'string',
        description: 'The price of the product, including currency symbol'
      },
      currency: {
        type: 'string',
        description: 'The currency code (USD, EUR, etc.)'
      },
      description: {
        type: 'string',
        description: 'Product description'
      },
      features: {
        type: 'array',
        description: 'List of product features',
        items: {
          type: 'string'
        }
      },
      specifications: {
        type: 'object',
        description: 'Technical specifications',
        additionalProperties: {
          type: 'string'
        }
      },
      images: {
        type: 'array',
        description: 'URLs of product images',
        items: {
          type: 'string'
        }
      },
      rating: {
        type: 'string',
        description: 'Product rating'
      }
    },
    required: ['name', 'price']
  },
  
  table: {
    type: 'object',
    title: 'Table',
    description: 'Extract table data into a structured format',
    properties: {
      title: {
        type: 'string',
        description: 'The title or caption of the table'
      },
      headers: {
        type: 'array',
        description: 'Column headers of the table',
        items: {
          type: 'string'
        }
      },
      rows: {
        type: 'array',
        description: 'Rows of data in the table',
        items: {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      },
      footnotes: {
        type: 'array',
        description: 'Any footnotes or explanations for the table',
        items: {
          type: 'string'
        }
      }
    },
    required: ['rows']
  }
}; 