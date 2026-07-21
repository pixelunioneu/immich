import { ModuleRef } from '@nestjs/core';
import { closeSync, constants, openSync, writeSync } from 'node:fs';
import { ImmichWorker } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { Mocked, vitest } from 'vitest';

vitest.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  openSync: vitest.fn(),
  writeSync: vitest.fn(),
  closeSync: vitest.fn(),
}));

const envWithEphemeral = (enabled: boolean) => ({
  ephemeralMicroservices: { enabled, wakeFifoPath: '/tmp/immich_microservices.wake' },
});

describe(JobRepository.name, () => {
  let sut: JobRepository;
  let configRepository: Mocked<Pick<ConfigRepository, 'getEnv' | 'getWorker'>>;
  let logger: { setContext: ReturnType<typeof vitest.fn>; debug: ReturnType<typeof vitest.fn> };

  beforeEach(() => {
    logger = { setContext: vitest.fn(), debug: vitest.fn() };
    vitest.mocked(openSync).mockReturnValue(3);
  });

  afterEach(() => {
    vitest.clearAllMocks();
  });

  const build = (worker: ImmichWorker | undefined, enabled: boolean) => {
    configRepository = {
      getEnv: vitest.fn().mockReturnValue(envWithEphemeral(enabled)),
      getWorker: vitest.fn().mockReturnValue(worker),
    };
    sut = new JobRepository(
      {} as ModuleRef,
      configRepository as unknown as ConfigRepository,
      {} as EventRepository,
      logger as unknown as LoggingRepository,
    );
  };

  const notify = () => (sut as unknown as { notifyMicroservicesWake: () => void }).notifyMicroservicesWake();

  it('should skip when the worker is not api', () => {
    build(ImmichWorker.Microservices, true);

    notify();

    expect(openSync).not.toHaveBeenCalled();
  });

  it('should skip when the feature is disabled', () => {
    build(ImmichWorker.Api, false);

    notify();

    expect(openSync).not.toHaveBeenCalled();
  });

  it('should write a wake byte to the fifo when enabled on the api worker', () => {
    build(ImmichWorker.Api, true);

    notify();

    expect(openSync).toHaveBeenCalledWith('/tmp/immich_microservices.wake', constants.O_WRONLY | constants.O_NONBLOCK);
    expect(writeSync).toHaveBeenCalledWith(3, '1\n');
    expect(closeSync).toHaveBeenCalledWith(3);
  });

  it('should swallow ENXIO (no reader/watcher present)', () => {
    build(ImmichWorker.Api, true);
    vitest.mocked(openSync).mockImplementation(() => {
      throw Object.assign(new Error('no such device or address'), { code: 'ENXIO' });
    });

    expect(() => notify()).not.toThrow();
    expect(logger.debug).toHaveBeenCalled();
    expect(closeSync).not.toHaveBeenCalled();
  });

  it('should swallow ENOENT (fifo does not exist / feature not deployed)', () => {
    build(ImmichWorker.Api, true);
    vitest.mocked(openSync).mockImplementation(() => {
      throw Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
    });

    expect(() => notify()).not.toThrow();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('should swallow EAGAIN', () => {
    build(ImmichWorker.Api, true);
    vitest.mocked(openSync).mockImplementation(() => {
      throw Object.assign(new Error('resource temporarily unavailable'), { code: 'EAGAIN' });
    });

    expect(() => notify()).not.toThrow();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('should swallow write errors and still attempt to close', () => {
    build(ImmichWorker.Api, true);
    vitest.mocked(writeSync).mockImplementation(() => {
      throw new Error('write failed');
    });

    expect(() => notify()).not.toThrow();
    expect(logger.debug).toHaveBeenCalled();
    expect(closeSync).toHaveBeenCalledWith(3);
  });
});
