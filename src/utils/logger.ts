/**
 * Structured JSON logging utility
 * Logs to stdout (INFO, DEBUG) and stderr (ERROR, WARN)
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export interface LogContext {
  eventId?: string;
  calendarId?: string;
  primaryUser?: string;
  secondaryUsers?: string[];
  operation?: string;
  duration?: number; // milliseconds
  error?: {
    message: string;
    stack?: string;
    code?: string | number;
  };
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

class Logger {
  private logLevel: LogLevel;

  constructor() {
    const level = process.env.LOG_LEVEL?.toUpperCase() as LogLevel;
    this.logLevel = ['ERROR', 'WARN', 'INFO', 'DEBUG'].includes(level)
      ? level
      : 'INFO';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
    return levels.indexOf(level) <= levels.indexOf(this.logLevel);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context }),
    };

    const output = JSON.stringify(entry);

    // ERROR and WARN to stderr, INFO and DEBUG to stdout
    if (level === 'ERROR' || level === 'WARN') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  error(message: string, context?: LogContext): void {
    this.log('ERROR', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log('DEBUG', message, context);
  }
}

// Singleton instance
export const logger = new Logger();
