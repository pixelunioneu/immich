import type { IncomingMessage, ServerResponse } from 'node:http';
import { BadRequest } from './errors.js';

const MAX_BODY_BYTES = 1024 * 1024;

export const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

export const sendEmpty = (res: ServerResponse, status: number) => {
  res.writeHead(status, { 'content-length': 0 });
  res.end();
};

/** Immich's error bodies are `{ message, error, statusCode }`. */
export const sendError = (
  res: ServerResponse,
  status: number,
  message: string,
  error: string,
) => sendJson(res, status, { message, error, statusCode: status });

export const readBody = async (
  req: IncomingMessage,
): Promise<Buffer | undefined> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new BadRequest('Request body too large');
    }
    chunks.push(chunk as Buffer);
  }

  return size === 0 ? undefined : Buffer.concat(chunks);
};

export const parseJson = (body: Buffer | undefined): unknown => {
  if (body === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new BadRequest('Malformed JSON body');
  }
};

export const readJsonBody = async (req: IncomingMessage): Promise<unknown> =>
  parseJson(await readBody(req));

/** One newline-delimited JSON document, the way the server streams sync data. */
export const sendJsonLines = (
  res: ServerResponse,
  status: number,
  lines: string,
) => {
  res.writeHead(status, {
    'content-type': 'application/jsonlines+json',
    'content-length': Buffer.byteLength(lines),
  });
  res.end(lines);
};

export const asStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new BadRequest(`${field} must be an array of strings`);
  }
  return value as string[];
};
