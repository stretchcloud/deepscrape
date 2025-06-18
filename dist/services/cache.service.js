"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
/**
 * Implements a file-based cache system for scraper responses
 */
class CacheService {
    constructor(options) {
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
    async get(key) {
        if (!this.options.enabled) {
            return null;
        }
        try {
            const cacheKey = this.generateCacheKey(key);
            const cacheFile = path_1.default.join(this.options.directory, `${cacheKey}.json`);
            const metadataFile = path_1.default.join(this.options.directory, `${cacheKey}.meta.json`);
            // Check if cache files exist
            if (!fs_1.default.existsSync(cacheFile) || !fs_1.default.existsSync(metadataFile)) {
                return null;
            }
            // Read metadata
            const metadata = JSON.parse(fs_1.default.readFileSync(metadataFile, 'utf-8'));
            // Check if cache is expired
            if (Date.now() > metadata.expiresAt) {
                logger_1.logger.debug(`Cache expired for key: ${key}`);
                this.invalidate(key);
                return null;
            }
            // Read cache data
            const cacheData = JSON.parse(fs_1.default.readFileSync(cacheFile, 'utf-8'));
            logger_1.logger.info(`Cache hit for key: ${key}`);
            return cacheData;
        }
        catch (error) {
            logger_1.logger.error(`Error reading from cache: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    /**
     * Store data in cache
     */
    async set(key, data, metadata) {
        if (!this.options.enabled) {
            return;
        }
        try {
            const cacheKey = this.generateCacheKey(key);
            const cacheFile = path_1.default.join(this.options.directory, `${cacheKey}.json`);
            const metadataFile = path_1.default.join(this.options.directory, `${cacheKey}.meta.json`);
            const now = Date.now();
            const ttl = metadata.customTtl || this.options.ttl;
            // Create metadata
            const cacheMetadata = {
                timestamp: now,
                expiresAt: now + (ttl * 1000),
                url: metadata.url,
                contentType: metadata.contentType
            };
            // Write cache data and metadata
            fs_1.default.writeFileSync(cacheFile, JSON.stringify(data));
            fs_1.default.writeFileSync(metadataFile, JSON.stringify(cacheMetadata));
            logger_1.logger.info(`Cache set for key: ${key} (TTL: ${ttl}s)`);
        }
        catch (error) {
            logger_1.logger.error(`Error writing to cache: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Remove item from cache
     */
    async invalidate(key) {
        if (!this.options.enabled) {
            return;
        }
        try {
            const cacheKey = this.generateCacheKey(key);
            const cacheFile = path_1.default.join(this.options.directory, `${cacheKey}.json`);
            const metadataFile = path_1.default.join(this.options.directory, `${cacheKey}.meta.json`);
            // Remove cache files if they exist
            if (fs_1.default.existsSync(cacheFile)) {
                fs_1.default.unlinkSync(cacheFile);
            }
            if (fs_1.default.existsSync(metadataFile)) {
                fs_1.default.unlinkSync(metadataFile);
            }
            logger_1.logger.info(`Cache invalidated for key: ${key}`);
        }
        catch (error) {
            logger_1.logger.error(`Error invalidating cache: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Clear all cached data
     */
    async clear() {
        if (!this.options.enabled) {
            return;
        }
        try {
            const files = fs_1.default.readdirSync(this.options.directory);
            for (const file of files) {
                fs_1.default.unlinkSync(path_1.default.join(this.options.directory, file));
            }
            logger_1.logger.info('Cache cleared');
        }
        catch (error) {
            logger_1.logger.error(`Error clearing cache: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Generate a deterministic cache key from a string
     */
    generateCacheKey(key) {
        return crypto_1.default.createHash('md5').update(key).digest('hex');
    }
    /**
     * Ensure the cache directory exists
     */
    ensureCacheDirectory() {
        try {
            if (!fs_1.default.existsSync(this.options.directory)) {
                fs_1.default.mkdirSync(this.options.directory, { recursive: true });
                logger_1.logger.info(`Created cache directory: ${this.options.directory}`);
            }
        }
        catch (error) {
            logger_1.logger.error(`Error creating cache directory: ${error instanceof Error ? error.message : String(error)}`);
            this.options.enabled = false;
        }
    }
}
exports.CacheService = CacheService;
