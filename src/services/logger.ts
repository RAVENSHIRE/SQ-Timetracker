/**
 * Logger Service
 * 
 * Centralized logging for console and production error tracking.
 * Provides structured logging with context.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, any>;
}

class Logger {
  private isDev = import.meta.env.DEV;

  private format(level: LogLevel, message: string, context?: Record<string, any>): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      context
    };
  }

  private output(entry: LogEntry): void {
    const prefix = `[${entry.level.toUpperCase()}]`;
    const msg = `${entry.timestamp} ${prefix} ${entry.message}`;

    if (entry.context) {
      if (this.isDev) {
        console[entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log'](msg, entry.context);
      } else {
        console[entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log'](msg);
        if (entry.level === 'error' || entry.level === 'warn') {
          console.log(entry.context);
        }
      }
    } else {
      console[entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log'](msg);
    }

    // In production, you could send errors to a service like Sentry
    if (!this.isDev && entry.level === 'error') {
      this.reportToService(entry);
    }
  }

  private reportToService(entry: LogEntry): void {
    // Placeholder for error reporting service (Sentry, LogRocket, etc.)
    // Example: Sentry.captureException(entry.context?.error);
  }

  info(message: string, context?: Record<string, any>): void {
    this.output(this.format('info', message, context));
  }

  warn(message: string, context?: Record<string, any>): void {
    this.output(this.format('warn', message, context));
  }

  error(message: string, context?: Record<string, any>): void {
    this.output(this.format('error', message, context));
  }

  debug(message: string, context?: Record<string, any>): void {
    if (this.isDev) {
      this.output(this.format('debug', message, context));
    }
  }
}

export const logger = new Logger();
