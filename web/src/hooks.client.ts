import { isHttpError, type ApiHttpError } from '@immich/sdk';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import type { ClientCaughtError, HandleClientError } from '@sveltejs/kit/hooks';

const DEFAULT_MESSAGE = 'Hmm, not sure about that. Check the logs or open a ticket?';

const parseHTTPError = (httpError: ApiHttpError) => {
  const statusCode = httpError?.status || httpError?.data?.statusCode || 500;
  const message = httpError?.data?.message || (httpError?.data && String(httpError.data)) || httpError?.message;

  console.log({
    status: statusCode,
    response: httpError?.data || 'No data',
  });

  return {
    message: message || DEFAULT_MESSAGE,
    code: statusCode,
    stack: httpError?.stack,
  };
};

const parseError = ({ kind, error }: ClientCaughtError) => {
  if (kind === 'unknown') {
    if (isHttpError(error)) {
      return parseHTTPError(error);
    }
    console.error(error);
    return;
  }

  return {
    message: error.message || DEFAULT_MESSAGE,
    code: error.status,
  };
};

const myHandleError: HandleClientError = (error) => {
  const result = parseError(error);

  console.error(`[hooks.client.ts]:handleError ${result?.message}`, error);
  return result;
};

// handleErrorWithSentry no-ops when Sentry hasn't been initialized (see sentry-manager.svelte.ts) —
// safe regardless of the user's telemetry preference or pre-login state.
export const handleError = handleErrorWithSentry(myHandleError);
