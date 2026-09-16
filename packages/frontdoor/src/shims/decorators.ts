/**
 * Stands in for `src/decorators` in the bundle. The real module reaches NestJS,
 * Swagger, lodash and the event repository; every decorator the bundled server
 * sources apply is metadata for a framework that is not running here.
 */
const noop = () => () => undefined;

export const GenerateSql = noop;
export const OnJob = noop;
export const OnEvent = noop;
export const ExtraModel = noop;
export const Endpoint = noop;

export class HistoryBuilder {
  added() {
    return this;
  }
  beta() {
    return this;
  }
  stable() {
    return this;
  }
  deprecated() {
    return this;
  }
  removed() {
    return this;
  }
}

export const DummyValue = {
  UUID: '00000000-0000-4000-a000-000000000000',
  UUID_SET: ['00000000-0000-4000-a000-000000000000'],
  PATH: '/path/to/file',
  STRING: 'abc',
  NUMBER: 123,
  BUFFER: Buffer.from('abc'),
  DATE: new Date(),
  TIME_BUCKET: '2024-01-01T00:00:00.000Z',
  BOOLEAN: true,
};
