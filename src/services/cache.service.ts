import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * Cache options interface
 */
export interface CacheOptions {
  enabled: boolean;
  ttl: number; // Time to live in seconds
  directory: string;
}

/**
 * Cache metadata interface
 */
interface CacheMetadata {
  timestamp: number;
  expiresAt: number;
  url: string;
  contentType: string;
}

/**
 * Implements a file-based cache system for scraper responses
 */
export class CacheService {
  private options: CacheOptions;
  
  constructor(options?: Partial<CacheOptions>) {
    this.options = {
      enabled: process.env.CACHE_ENABLED === 'true',
      ttl: Number(process.env.CACHE_TTL || 3600), // Default: 1 hour
      directory: process.env.CACHE_DIRECTORY || './cache',
      ...options
    };
    
    // Create cache directory if it doesn't exist
    if (this.options.enabled) {
      this.ensureCacheDirectory();
    }
  }
  
  /**
   * Get data from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.options.enabled) {
      return null;
    }
    
    try {
      const cacheKey = this.generateCacheKey(key);
      const cacheFile = path.join(this.options.directory, `${cacheKey}.json`);
      const metadataFile = path.join(this.options.directory, `${cacheKey}.meta.json`);
      
      // Check if cache files exist
      if (!fs.existsSync(cacheFile) || !fs.existsSync(metadataFile)) {
        return null;
      }
      
      // Read metadata
      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf-8')) as CacheMetadata;
      
      // Check if cache is expired
      if (Date.now() > metadata.expiresAt) {
        logger.debug(`Cache expired for key: ${key}`);
        this.invalidate(key);
        return null;
      }
      
      // Read cache data
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as T;
      logger.info(`Cache hit for key: ${key}`);
      return cacheData;
    } catch (error) {
      logger.error(`Error reading from cache: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Store data in cache
   */
  async set<T>(key: string, data: T, metadata: { url: string; contentType: string; customTtl?: number }): Promise<void> {
    if (!this.options.enabled) {
      return;
    }
    
    try {
      const cacheKey = this.generateCacheKey(key);
      const cacheFile = path.join(this.options.directory, `${cacheKey}.json`);
      const metadataFile = path.join(this.options.directory, `${cacheKey}.meta.json`);
      
      const now = Date.now();
      const ttl = metadata.customTtl || this.options.ttl;
      
      // Create metadata
      const cacheMetadata: CacheMetadata = {
        timestamp: now,
        expiresAt: now + (ttl * 1000),
        url: metadata.url,
        contentType: metadata.contentType
      };
      
      // Write cache data and metadata
      fs.writeFileSync(cacheFile, JSON.stringify(data));
      fs.writeFileSync(metadataFile, JSON.stringify(cacheMetadata));
      
      logger.info(`Cache set for key: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      logger.error(`Error writing to cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Remove item from cache
   */
  async invalidate(key: string): Promise<void> {
    if (!this.options.enabled) {
      return;
    }
    
    try {
      const cacheKey = this.generateCacheKey(key);
      const cacheFile = path.join(this.options.directory, `${cacheKey}.json`);
      const metadataFile = path.join(this.options.directory, `${cacheKey}.meta.json`);
      
      // Remove cache files if they exist
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }
      
      if (fs.existsSync(metadataFile)) {
        fs.unlinkSync(metadataFile);
      }
      
      logger.info(`Cache invalidated for key: ${key}`);
    } catch (error) {
      logger.error(`Error invalidating cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }
    
    try {
      const files = fs.readdirSync(this.options.directory);
      
      for (const file of files) {
        fs.unlinkSync(path.join(this.options.directory, file));
      }
      
      logger.info('Cache cleared');
    } catch (error) {
      logger.error(`Error clearing cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate a deterministic cache key from a string
   */
  private generateCacheKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex');
  }
  
  /**
   * Ensure the cache directory exists
   */
  private ensureCacheDirectory(): void {
    try {
      if (!fs.existsSync(this.options.directory)) {
        fs.mkdirSync(this.options.directory, { recursive: true });
        logger.info(`Created cache directory: ${this.options.directory}`);
      }
    } catch (error) {
      logger.error(`Error creating cache directory: ${error instanceof Error ? error.message : String(error)}`);
      this.options.enabled = false;
    }
  }
} 