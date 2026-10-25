export class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'error';
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Please sign in') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');
export const conflict = (msg) => new HttpError(409, msg, 'conflict');
export const tooMany = (msg) => new HttpError(429, msg, 'rate_limited');

// Wrap async route handlers so thrown errors reach the error middleware.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
