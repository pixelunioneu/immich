/**
 * Errors this service raises deliberately, as opposed to anything that escapes
 * from a driver or a bug. The distinction matters at two points: the database
 * layer passes these through untouched instead of reclassifying them, and the
 * request handler maps them to a status rather than a 500.
 */
export abstract class FrontdoorError extends Error {
  abstract readonly status: number;
  abstract readonly reason: string;
}

/** A malformed request. */
export class BadRequest extends FrontdoorError {
  readonly status = 400;
  readonly reason = 'bad_request';
}

/** An ack naming a sync entity type the server does not know. */
export class InvalidAckType extends FrontdoorError {
  readonly status = 400;
  readonly reason = 'invalid_ack_type';

  constructor(readonly type: string) {
    super(`Invalid ack type: ${type}`);
  }
}

/**
 * The tenant's database could not be reached, or is failing fast behind the
 * circuit breaker. This is a 503 rather than a 500 on purpose: the service is
 * working, its dependency is not, and the two should not page the same way.
 */
export class TenantDatabaseUnavailable extends FrontdoorError {
  readonly status = 503;

  constructor(readonly reason: string) {
    super(`Tenant database unavailable: ${reason}`);
  }
}
