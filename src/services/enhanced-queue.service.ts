import { Queue, Worker, Job, QueueEvents, ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../utils/logger';
import { redisClient } from './redis.service';

export interface QueueConfig {
  concurrency: number;
  maxJobs: number;
  lockDuration: number;
  lockRenewTime: number;
  retryAttempts: number;
  retryDelay: number;
  enableDynamicScaling: boolean;
  maxConcurrency: number;
  minConcurrency: number;
}

export interface JobOptions {
  priority?: number;
  delay?: number;
  lockDuration?: number;
  attempts?: number;
  removeOnComplete?: number;
  removeOnFail?: number;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  currentConcurrency: number;
  throughput: number; // jobs per minute
}

export interface SystemLoad {
  cpu: number;
  memory: number;
  activeConnections: number;
}

/**
 * Enhanced queue service with advanced features inspired by Firecrawl
 * Includes job locking, dynamic concurrency, and sophisticated error handling
 */
export class EnhancedQueueService {
  private queue: Queue;
  private worker: Worker | null = null;
  private queueEvents: QueueEvents;
  private redis: Redis;
  private config: QueueConfig;
  private isShuttingDown = false;
  private lockExtensionIntervals = new Map<string, NodeJS.Timeout>();
  private throughputTracker = {
    processedJobs: 0,
    startTime: Date.now(),
    lastResetTime: Date.now()
  };

  constructor(queueName: string, config: Partial<QueueConfig> = {}) {
    this.config = {
      concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
      maxJobs: parseInt(process.env.QUEUE_MAX_JOBS || '1000'),
      lockDuration: parseInt(process.env.QUEUE_LOCK_DURATION || '120000'), // 2 minutes
      lockRenewTime: parseInt(process.env.QUEUE_LOCK_RENEW_TIME || '30000'), // 30 seconds
      retryAttempts: parseInt(process.env.QUEUE_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '5000'),
      enableDynamicScaling: process.env.QUEUE_ENABLE_DYNAMIC_SCALING === 'true',
      maxConcurrency: parseInt(process.env.QUEUE_MAX_CONCURRENCY || '20'),
      minConcurrency: parseInt(process.env.QUEUE_MIN_CONCURRENCY || '1'),
      ...config
    };

    const connection: ConnectionOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
    };

    this.redis = redisClient;

    this.queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: this.config.retryAttempts,
        backoff: {
          type: 'exponential',
          delay: this.config.retryDelay,
        },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    });

    this.queueEvents = new QueueEvents(queueName, { connection });
    this.setupEventListeners();
    
    // Start dynamic scaling if enabled
    if (this.config.enableDynamicScaling) {
      this.startDynamicScaling();
    }

    logger.info(`Enhanced queue service initialized: ${queueName}`, {
      config: this.config,
      queueName
    });
  }

  /**
   * Add job with enhanced options and duplicate prevention
   */
  async addJob(
    jobName: string, 
    data: any, 
    options: JobOptions = {}
  ): Promise<Job> {
    if (this.isShuttingDown) {
      throw new Error('Queue is shutting down, cannot add new jobs');
    }

    // Generate job ID to prevent duplicates if needed
    const jobId = options.priority !== undefined ? undefined : this.generateJobId(jobName, data);

    const jobOptions = {
      priority: options.priority ?? 0,
      delay: options.delay ?? 0,
      attempts: options.attempts ?? this.config.retryAttempts,
      removeOnComplete: options.removeOnComplete ?? 50,
      removeOnFail: options.removeOnFail ?? 20,
      backoff: {
        type: 'exponential' as const,
        delay: this.config.retryDelay,
      },
      ...(jobId && { jobId })
    };

    try {
      const job = await this.queue.add(jobName, data, jobOptions);
      logger.debug(`Job added to queue: ${jobName}`, {
        jobId: job.id,
        priority: jobOptions.priority,
        delay: jobOptions.delay
      });
      return job;
    } catch (error) {
      logger.error(`Failed to add job to queue: ${jobName}`, { 
        error: (error as Error).message,
        data,
        options: jobOptions
      });
      throw error;
    }
  }

  /**
   * Add multiple jobs in bulk with optimized performance
   */
  async addBulkJobs(jobs: Array<{
    name: string;
    data: any;
    opts?: JobOptions;
  }>): Promise<Job[]> {
    if (this.isShuttingDown) {
      throw new Error('Queue is shutting down, cannot add new jobs');
    }

    const bulkJobs = jobs.map(job => ({
      name: job.name,
      data: job.data,
      opts: {
        priority: job.opts?.priority ?? 0,
        delay: job.opts?.delay ?? 0,
        attempts: job.opts?.attempts ?? this.config.retryAttempts,
        removeOnComplete: job.opts?.removeOnComplete ?? 50,
        removeOnFail: job.opts?.removeOnFail ?? 20,
        backoff: {
          type: 'exponential' as const,
          delay: this.config.retryDelay,
        },
      }
    }));

    try {
      const addedJobs = await this.queue.addBulk(bulkJobs);
      logger.info(`Bulk jobs added to queue`, {
        count: addedJobs.length,
        jobNames: jobs.map(j => j.name)
      });
      return addedJobs;
    } catch (error) {
      logger.error(`Failed to add bulk jobs to queue`, { 
        error: (error as Error).message,
        jobCount: jobs.length
      });
      throw error;
    }
  }

  /**
   * Initialize worker with enhanced job processing and lock management
   */
  initializeWorker(processor: (job: Job) => Promise<any>): Worker {
    if (this.worker) {
      logger.warn('Worker already initialized, stopping existing worker');
      this.worker.close();
    }

    this.worker = new Worker(
      this.queue.name,
      async (job: Job) => {
        const startTime = Date.now();
        const jobId = job.id!;
        
        try {
          // Setup lock extension for long-running jobs
          this.setupLockExtension(job);

          // Update throughput tracking
          this.updateThroughputTracker();

          logger.info(`Processing job: ${job.name}`, {
            jobId,
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts
          });

          // Execute the job processor
          const result = await processor(job);
          
          // Clean up lock extension
          this.cleanupLockExtension(jobId);
          
          const duration = Date.now() - startTime;
          logger.info(`Job completed: ${job.name}`, {
            jobId,
            duration,
            attempt: job.attemptsMade + 1
          });
          
          return result;
        } catch (error) {
          // Clean up lock extension on error
          this.cleanupLockExtension(jobId);
          
          const duration = Date.now() - startTime;
          logger.error(`Job failed: ${job.name}`, {
            jobId,
            duration,
            attempt: job.attemptsMade + 1,
            error: (error as Error).message
          });
          throw error;
        }
      },
      {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD || undefined,
        },
        concurrency: this.config.concurrency,
        lockDuration: this.config.lockDuration,
        lockRenewTime: this.config.lockRenewTime,
      }
    );

    // Setup worker event listeners
    this.setupWorkerEventListeners();

    logger.info(`Worker initialized with concurrency: ${this.config.concurrency}`);
    return this.worker;
  }

  /**
   * Setup automatic lock extension for long-running jobs
   */
  private setupLockExtension(job: Job): void {
    const jobId = job.id!;
    
    const interval = setInterval(async () => {
      try {
        await job.extendLock('', this.config.lockRenewTime);
        logger.debug(`Extended lock for job ${jobId}`);
      } catch (error) {
        logger.warn(`Failed to extend lock for job ${jobId}`, {
          error: (error as Error).message
        });
        clearInterval(interval);
        this.lockExtensionIntervals.delete(jobId);
      }
    }, this.config.lockRenewTime * 0.8); // Extend at 80% of lock time

    this.lockExtensionIntervals.set(jobId, interval);
  }

  /**
   * Clean up lock extension interval
   */
  private cleanupLockExtension(jobId: string): void {
    const interval = this.lockExtensionIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.lockExtensionIntervals.delete(jobId);
    }
  }

  /**
   * Update throughput tracking metrics
   */
  private updateThroughputTracker(): void {
    this.throughputTracker.processedJobs++;
    
    // Reset every hour to keep metrics fresh
    const now = Date.now();
    if (now - this.throughputTracker.lastResetTime > 3600000) { // 1 hour
      this.throughputTracker.processedJobs = 1;
      this.throughputTracker.startTime = now;
      this.throughputTracker.lastResetTime = now;
    }
  }

  /**
   * Get comprehensive queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed(),
      this.queue.isPaused()
    ]);

    // Calculate throughput (jobs per minute)
    const elapsed = Date.now() - this.throughputTracker.startTime;
    const throughput = elapsed > 0 ? (this.throughputTracker.processedJobs / elapsed) * 60000 : 0;

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      paused: paused ? 1 : 0,
      currentConcurrency: this.config.concurrency,
      throughput
    };
  }

  /**
   * Dynamic concurrency adjustment based on system load and queue metrics
   */
  async adjustConcurrency(): Promise<void> {
    if (!this.config.enableDynamicScaling || !this.worker) {
      return;
    }

    try {
      const stats = await this.getStats();
      const systemLoad = await this.getSystemLoad();
      
      let newConcurrency = this.config.concurrency;
      
      // Increase concurrency if:
      // - System load is reasonable
      // - Many jobs are waiting
      // - We're below max concurrency
      if (systemLoad.cpu < 70 && 
          systemLoad.memory < 80 && 
          stats.waiting > 10 && 
          this.config.concurrency < this.config.maxConcurrency) {
        newConcurrency = Math.min(this.config.concurrency + 1, this.config.maxConcurrency);
      }
      
      // Decrease concurrency if:
      // - System load is high
      // - We're above min concurrency
      else if ((systemLoad.cpu > 85 || systemLoad.memory > 90) && 
               this.config.concurrency > this.config.minConcurrency) {
        newConcurrency = Math.max(this.config.concurrency - 1, this.config.minConcurrency);
      }
      
      if (newConcurrency !== this.config.concurrency) {
        this.config.concurrency = newConcurrency;
        
        // Update worker concurrency (BullMQ doesn't support runtime changes,
        // so we'll restart the worker if needed)
        logger.info(`Adjusting queue concurrency to ${newConcurrency}`, {
          previousConcurrency: this.config.concurrency,
          systemLoad,
          queueStats: stats
        });
        
        // Note: In production, you might want to implement graceful worker restart
        // For now, we'll just log the change
      }
    } catch (error) {
      logger.error('Failed to adjust concurrency', { 
        error: (error as Error).message 
      });
    }
  }

  /**
   * Start dynamic scaling monitoring
   */
  private startDynamicScaling(): void {
    // Check every 30 seconds
    setInterval(() => {
      if (!this.isShuttingDown) {
        this.adjustConcurrency();
      }
    }, 30000);
  }

  /**
   * Get system load metrics (placeholder implementation)
   */
  private async getSystemLoad(): Promise<SystemLoad> {
    // In a real implementation, you would measure actual CPU and memory usage
    // For now, we'll return mock values
    return {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      activeConnections: Math.floor(Math.random() * 50)
    };
  }

  /**
   * Generate deterministic job ID for duplicate prevention
   */
  private generateJobId(jobName: string, data: any): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    hash.update(jobName);
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }

  /**
   * Setup event listeners for queue monitoring
   */
  private setupEventListeners(): void {
    this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
      logger.debug('Job completed', { jobId, hasReturnValue: !!returnvalue });
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Job failed', { jobId, failedReason });
    });

    this.queueEvents.on('stalled', ({ jobId }) => {
      logger.warn('Job stalled', { jobId });
    });

    this.queueEvents.on('progress', ({ jobId, data }) => {
      logger.debug('Job progress', { jobId, progress: data });
    });

    this.queueEvents.on('removed', ({ jobId }) => {
      logger.debug('Job removed', { jobId });
    });
  }

  /**
   * Setup worker-specific event listeners
   */
  private setupWorkerEventListeners(): void {
    if (!this.worker) return;

    this.worker.on('completed', (job) => {
      logger.debug(`Worker completed job: ${job.name}`, { jobId: job.id });
    });

    this.worker.on('failed', (job, err) => {
      logger.error(`Worker failed job: ${job?.name}`, { 
        jobId: job?.id, 
        error: err.message 
      });
    });

    this.worker.on('error', (err) => {
      logger.error('Worker error', { error: err.message });
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn('Worker job stalled', { jobId });
    });
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    logger.info('Queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    logger.info('Queue resumed');
  }

  /**
   * Clean up completed and failed jobs
   */
  async cleanup(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - maxAge;
    
    try {
      await this.queue.clean(cutoff, 0, 'completed');
      await this.queue.clean(cutoff, 0, 'failed');
      logger.info('Queue cleanup completed', { maxAge });
    } catch (error) {
      logger.error('Queue cleanup failed', { error: (error as Error).message });
    }
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    this.isShuttingDown = true;
    
    logger.info('Shutting down enhanced queue service...');
    
    // Clear all lock extension intervals
    for (const interval of this.lockExtensionIntervals.values()) {
      clearInterval(interval);
    }
    this.lockExtensionIntervals.clear();

    // Close worker
    if (this.worker) {
      await this.worker.close();
      logger.info('Worker closed');
    }

    // Close queue and events
    await Promise.all([
      this.queue.close(),
      this.queueEvents.close()
    ]);

    logger.info('Enhanced queue service shutdown complete');
  }

  // Getters for accessing internal state
  get name(): string {
    return this.queue.name;
  }

  get isReady(): boolean {
    return !this.isShuttingDown && !!this.worker;
  }

  get currentConfig(): QueueConfig {
    return { ...this.config };
  }

  // Getter for accessing the underlying queue (for legacy compatibility)
  get bullQueue(): Queue {
    return this.queue;
  }
}