/**
 * Structured logging utilities
 */

export interface LogContext {
  shopId?: string;
  shopDomain?: string;
  orderId?: string;
  orderNumber?: string;
  userId?: string;
  requestId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Create a structured log entry
 */
function createLogEntry(
  level: LogEntry['level'],
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  
  if (context) {
    entry.context = context;
  }
  
  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  
  return entry;
}

/**
 * Log debug message
 */
export function debug(message: string, context?: LogContext): void {
  const entry = createLogEntry('debug', message, context);
  console.debug(JSON.stringify(entry));
}

/**
 * Log info message
 */
export function info(message: string, context?: LogContext): void {
  const entry = createLogEntry('info', message, context);
  console.info(JSON.stringify(entry));
}

/**
 * Log warning message
 */
export function warn(message: string, context?: LogContext, error?: Error): void {
  const entry = createLogEntry('warn', message, context, error);
  console.warn(JSON.stringify(entry));
}

/**
 * Log error message
 */
export function error(message: string, context?: LogContext, err?: Error): void {
  const entry = createLogEntry('error', message, context, err);
  console.error(JSON.stringify(entry));
}

/**
 * Create a logger with default context
 */
export function createLogger(defaultContext: LogContext) {
  return {
    debug: (message: string, context?: LogContext) => 
      debug(message, { ...defaultContext, ...context }),
    info: (message: string, context?: LogContext) => 
      info(message, { ...defaultContext, ...context }),
    warn: (message: string, context?: LogContext, error?: Error) => 
      warn(message, { ...defaultContext, ...context }, error),
    error: (message: string, context?: LogContext, err?: Error) => 
      error(message, { ...defaultContext, ...context }, err),
  };
}

/**
 * Log performance metrics
 */
export function logPerformance(
  operation: string,
  duration: number,
  context?: LogContext
): void {
  info(`Performance: ${operation}`, {
    ...context,
    operation,
    duration,
    unit: 'ms',
  });
}

/**
 * Measure and log execution time
 */
export async function measureTime<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: LogContext
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    logPerformance(operation, duration, context);
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    error(`${operation} failed after ${duration}ms`, context, err as Error);
    throw err;
  }
}

