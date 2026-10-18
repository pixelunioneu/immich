import { BadRequestException, CallHandler, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { ErrorInterceptor } from 'src/middleware/error.interceptor.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { automock } from 'test/utils.js';

function uploadAsset() {}

const context = {
  switchToHttp: () => ({
    getRequest: () => ({ destroyed: false, complete: true }),
    getResponse: () => ({ headersSent: false }),
  }),
  getHandler: () => uploadAsset,
} as unknown as ExecutionContext;

const errnoError = (props: { code?: string; errno?: number }) => Object.assign(new Error('fs error'), props);

describe(ErrorInterceptor.name, () => {
  let sut: ErrorInterceptor;

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    const logger = automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false });
    sut = new ErrorInterceptor(logger as unknown as LoggingRepository);
  });

  const run = (error: unknown) => {
    const next: CallHandler = { handle: () => throwError(() => error) };
    return lastValueFrom(sut.intercept(context, next));
  };

  // PixelUnion: storage exhaustion is a client-visible 400, not a 500.
  it.each([
    ['ENOSPC', { code: 'ENOSPC' }],
    ['ENOENT', { code: 'ENOENT' }],
    ['EDQUOT', { code: 'EDQUOT' }],
    ['errno -122', { errno: -122 }],
  ])('should map %s to Not enough storage', async (_, props) => {
    await expect(run(errnoError(props))).rejects.toThrow(new BadRequestException('Not enough storage'));
  });

  it('should map other errors to a 500 with the route message', async () => {
    const error = await run(errnoError({ code: 'EACCES' })).catch((error_) => error_);

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).toBe('Failed to upload asset');
  });

  it('should pass http exceptions through unchanged', async () => {
    const original = new BadRequestException('Quota has been exceeded!');

    await expect(run(original)).rejects.toBe(original);
  });
});
