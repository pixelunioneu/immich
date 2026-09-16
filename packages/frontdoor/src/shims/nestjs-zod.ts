/**
 * Stands in for `nestjs-zod`. The server's DTO classes are only used as types in
 * this package, but their modules call `createZodDto` at load time.
 */
export const createZodDto = <T>(schema: T) =>
  class {
    static schema = schema;
  };
