/**
 * Stands in for `@nestjs/common` in the bundle: the decorators become no-ops, and
 * the two exceptions the sync service throws keep their status so the request
 * layer can answer with upstream's own message.
 */
const noop = () => () => undefined;

export const Injectable = noop;
export const SetMetadata = noop;
export const applyDecorators = noop;

export class HttpException extends Error {
  constructor(
    message: string,
    private readonly status: number,
  ) {
    super(message);
  }

  getStatus() {
    return this.status;
  }
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/** `src/validation` subclasses this at module load; nothing here ever calls it. */
export abstract class FileValidator {
  constructor(protected readonly validationOptions: unknown = {}) {}
  abstract isValid(file?: unknown): boolean | Promise<boolean>;
  abstract buildErrorMessage(file: unknown): string;
}
