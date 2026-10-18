import {
  confirmEmailChange,
  PU_MGMT_API_BASE,
  PuEmailChangeError,
  PuReauthRequiredError,
  requestEmailChange,
} from '$lib/services/pu-email-change';
import { getPuOidcAccessToken } from '$lib/utils/pu-oidc';

vi.mock('$lib/utils/pu-oidc', () => ({
  getPuOidcAccessToken: vi.fn(),
  clearPuOidcAccessTokenCache: vi.fn(),
}));

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });

describe('pu-email-change', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.mocked(getPuOidcAccessToken).mockReset().mockResolvedValue('access-token');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('requestEmailChange', () => {
    it('posts the normalized email with the OIDC bearer token', async () => {
      const result = { message: 'sent', oldEmail: 'old@example.com', newEmail: 'new@example.com' };
      fetchMock.mockResolvedValue(jsonResponse(result));

      await expect(requestEmailChange('  New@Example.COM ')).resolves.toEqual(result);

      expect(fetchMock).toHaveBeenCalledWith(`${PU_MGMT_API_BASE}/api/user/email-change/request`, {
        method: 'POST',
        headers: { Authorization: 'Bearer access-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_email: 'new@example.com' }),
      });
    });

    it('throws PuReauthRequiredError without calling the API when no token is available', async () => {
      vi.mocked(getPuOidcAccessToken).mockResolvedValue(null);

      await expect(requestEmailChange('new@example.com')).rejects.toBeInstanceOf(PuReauthRequiredError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('confirmEmailChange', () => {
    it('posts the normalized code', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: 'ok', summary: { oldEmail: 'a', newEmail: 'b' } }));

      await confirmEmailChange('  ab12cd ');

      expect(fetchMock).toHaveBeenCalledWith(
        `${PU_MGMT_API_BASE}/api/user/email-change/confirm`,
        expect.objectContaining({ body: JSON.stringify({ code: 'AB12CD' }) }),
      );
    });
  });

  describe('errors', () => {
    const errorFor = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

    it('uses a string detail as the message', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Code expired' }, 400));

      const error = await errorFor(confirmEmailChange('abc'));

      expect(error).toBeInstanceOf(PuEmailChangeError);
      expect(error).toMatchObject({ message: 'Code expired', status: 400 });
    });

    it('joins validation error details', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: [{ msg: 'invalid email' }, { msg: 'too long' }] }, 422));

      await expect(requestEmailChange('x')).rejects.toMatchObject({ message: 'invalid email, too long', status: 422 });
    });

    it('falls back to the message field', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: 'Server says no' }, 500));

      await expect(requestEmailChange('x')).rejects.toMatchObject({ message: 'Server says no', status: 500 });
    });

    it.each([
      [400, 'Invalid request'],
      [401, 'Authentication required'],
      [409, 'Email address already in use'],
      [429, 'Too many verification attempts'],
      [503, 'Email change request failed'],
    ])('falls back to a default message for HTTP %s', async (status, message) => {
      fetchMock.mockResolvedValue(new Response('not json', { status }));

      await expect(requestEmailChange('x')).rejects.toMatchObject({ message, status });
    });
  });
});
