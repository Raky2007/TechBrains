import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const requestCounts = new Map<string, RateLimitRecord>();

// Clean up expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now > record.resetTime) {
      requestCounts.delete(key);
    }
  }
}, 60000);

/**
 * Lightweight in-memory rate limiter for LAN environment.
 * @param windowMs Time window in milliseconds
 * @param max Max requests per window
 * @param message Error message
 */
export function rateLimiter(windowMs: number, max: number, message = 'Too many requests, please try again shortly') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();

    const record = requestCounts.get(key);

    if (!record || now > record.resetTime) {
      requestCounts.set(key, {
        count: 1,
        resetTime: now + windowMs
      });
      return next();
    }

    if (record.count >= max) {
      res.status(429).json({ error: message });
      return;
    }

    record.count++;
    next();
  };
}
