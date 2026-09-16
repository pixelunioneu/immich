/**
 * PixelUnion addition: Sentry error tracking, opt-in via SENTRY_DSN.
 * Import this module first, before any other import - Sentry's auto-instrumentation
 * only patches modules that are required after `init()` runs.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({ dsn, sendDefaultPii: true });
}
