import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { validationResult } from 'express-validator';
import { logger } from '../../utils/logger';

/**
 * Middleware to validate requests using Zod schemas
 */
export const validateRequest = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body against schema
      const result = schema.safeParse(req.body);
      
      if (!result.success) {
        logger.warn(`Request validation failed: ${JSON.stringify(result.error)}`);
        
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: result.error.errors
        });
      }
      
      // Validation successful, continue
      req.body = result.data;
      next();
    } catch (error) {
      logger.error(`Error in validation middleware: ${error instanceof Error ? error.message : String(error)}`);
      
      return res.status(500).json({
        success: false,
        error: 'Server error during validation'
      });
    }
  };
};

/**
 * Middleware to handle express-validator validation results
 */
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      logger.warn(`Express-validator validation failed: ${JSON.stringify(errors.array())}`);
      
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: errors.array()
      });
    }
    
    // Validation successful, continue
    next();
  } catch (error) {
    logger.error(`Error in express-validator middleware: ${error instanceof Error ? error.message : String(error)}`);
    
    return res.status(500).json({
      success: false,
      error: 'Server error during validation'
    });
  }
}; 