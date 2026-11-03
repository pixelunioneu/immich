import { getReferral } from '$lib/services/pu-referral.service';

const PRD_BASE = 'https://api.prd.tech.pixelunion.eu/api/referral';
const NONPRD_BASE = 'https://api.nonprd.tech.pixelunion.eu/api/referral';

const REFERRAL = {
  referral_id: '0b6f2a4e-8f7c-4a57-9c1e-3d2b1a0f9e8d',
  referral_url: 'https://pixelunion.eu/?ref=0b6f2a4e-8f7c-4a57-9c1e-3d2b1a0f9e8d',
};

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });

const setHostname = (hostname: string) => vi.stubGlobal('location', { hostname });

describe('pu-referral.service', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setHostname('mytenant.pixelunion.eu');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('looks up the referral by the current host on production', async () => {
    fetchMock.mockResolvedValue(jsonResponse(REFERRAL));

    const result = await getReferral();

    expect(result).toEqual({ status: 'ok', referral: REFERRAL });
    expect(fetchMock).toHaveBeenCalledWith(`${PRD_BASE}/mytenant.pixelunion.eu`);
  });

  it('targets nonprd for nonprd hosts', async () => {
    setHostname('mytenant.nonprd.tech.pixelunion.eu');
    fetchMock.mockResolvedValue(jsonResponse(REFERRAL));

    await getReferral();

    expect(fetchMock).toHaveBeenCalledWith(`${NONPRD_BASE}/mytenant.nonprd.tech.pixelunion.eu`);
  });

  it('does not send credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(REFERRAL));

    await getReferral();

    expect(fetchMock.mock.calls[0]).toHaveLength(1);
  });

  it('returns none on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Referral not found' }, 404));

    expect(await getReferral()).toEqual({ status: 'none' });
  });

  it.each([429, 500, 503])('returns unavailable on %i', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, status));

    expect(await getReferral()).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable on a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await getReferral()).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable on an unexpected body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ referral_id: REFERRAL.referral_id }));

    expect(await getReferral()).toEqual({ status: 'unavailable' });
  });
});
