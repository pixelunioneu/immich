import { StorageWarningLevel } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { locale } from '#lib/stores/preferences.store.ts';
import { PU_BILLING_PORTAL_URL } from '#lib/utils/pu-api.ts';
import { openStorageWarningModal } from '#lib/utils/storage-warning-modal.ts';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import StorageFullModal from './StorageFullModal.svelte';

const referral = vi.hoisted(() => ({ loadReferral: vi.fn() }));

// Keep the real eligibility rule; only the network lookup is faked.
vi.mock('#lib/services/pu-referral.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/services/pu-referral.service.ts')>()),
  loadReferral: referral.loadReferral,
}));

const GiB = 1024 ** 3;

type Props = {
  level: StorageWarningLevel;
  usedBytes: number;
  totalBytes: number;
  isAdmin: boolean;
  showReferral: boolean;
  onClose: () => void;
};

const renderModal = (props: Partial<Props> = {}) => {
  const onClose = vi.fn();
  render(StorageFullModal, {
    level: StorageWarningLevel.AlmostFull,
    usedBytes: 8.5 * GiB,
    totalBytes: 10 * GiB,
    isAdmin: true,
    showReferral: false,
    onClose,
    ...props,
  });
  return { onClose };
};

const link = (name: RegExp) => screen.getByRole('link', { name });

// PixelUnion: at 80% and 95% of the storage, a popup explains what is going on and offers a way out:
// upgrade (tenant owner) or ask the owner, invite a friend for extra storage, or clean up.
describe('StorageFullModal (PixelUnion)', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
    locale.set('en-US');
  });

  it('says the storage is almost full, with the usage in GB and percent', () => {
    renderModal({ level: StorageWarningLevel.AlmostFull, usedBytes: 8.5 * GiB, totalBytes: 10 * GiB });

    expect(screen.getByText('Your storage is almost full')).toBeInTheDocument();
    expect(screen.getByText('8.5 GB of 10 GB used')).toBeInTheDocument();
    expect(screen.getByText("You've used 85% of your storage.")).toBeInTheDocument();
    expect(screen.getByText("When it's full, new photos and videos can't be uploaded.")).toBeInTheDocument();
  });

  it('says the storage is full, capping the percentage at 100', () => {
    renderModal({ level: StorageWarningLevel.Full, usedBytes: 11 * GiB, totalBytes: 10 * GiB });

    expect(screen.getByText('Your storage is full')).toBeInTheDocument();
    expect(screen.getByText("You've used 100% of your storage.")).toBeInTheDocument();
    expect(screen.getByText("New photos and videos can't be uploaded until there is space again.")).toBeInTheDocument();
  });

  it('lets the tenant owner upgrade in the Stripe portal, in a new tab', async () => {
    const { onClose } = renderModal({ isAdmin: true });

    const upgrade = link(/Upgrade your plan/);
    expect(upgrade).toHaveAttribute('href', PU_BILLING_PORTAL_URL);
    expect(upgrade).toHaveAttribute('target', '_blank');
    expect(screen.queryByText('Ask for more storage')).not.toBeInTheDocument();

    upgrade.addEventListener('click', (event) => event.preventDefault());
    upgrade.click();
    expect(onClose).toHaveBeenCalled();
  });

  it('tells regular users to ask their administrator instead of linking to billing', () => {
    renderModal({ isAdmin: false });

    expect(screen.getByText('Ask for more storage')).toBeInTheDocument();
    expect(screen.queryByText('Upgrade your plan')).not.toBeInTheDocument();
    expect(document.querySelector(`a[href="${PU_BILLING_PORTAL_URL}"]`)).toBeNull();
  });

  it('offers the referral page only when asked to', () => {
    renderModal({ showReferral: true });
    expect(link(/Invite a friend/)).toHaveAttribute('href', '/referral');
  });

  it('hides the referral option when not asked to', () => {
    renderModal({ showReferral: false });
    expect(screen.queryByText('Invite a friend')).not.toBeInTheDocument();
  });

  it('always offers clean-up via the utilities page', () => {
    renderModal({ isAdmin: false });
    expect(link(/Clean up/)).toHaveAttribute('href', '/utilities');
  });

  it('closes on "Not now"', () => {
    const { onClose } = renderModal();

    screen.getByRole('button', { name: 'Not now' }).click();

    expect(onClose).toHaveBeenCalled();
  });
});

// The helper both the automatic check and the sidebar button use to open the popup.
describe('openStorageWarningModal (PixelUnion)', () => {
  let show: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    show.mockRestore();
    referral.loadReferral.mockReset();
    authManager.reset();
  });

  const login = (isAdmin: boolean) => {
    authManager.setUser(userAdminFactory.build({ isAdmin }));
    authManager.setPreferences(preferencesFactory.build());
  };

  const ok = { status: 'ok', referral: { referral_id: 'abc', referral_url: 'https://pixelunion.eu/?ref=abc' } };

  it('opens the popup with the usage, admin flag and referral for an eligible tenant', async () => {
    login(true);
    referral.loadReferral.mockResolvedValue(ok);

    await openStorageWarningModal(StorageWarningLevel.Full, { usedBytes: 9.6 * GiB, totalBytes: 10 * GiB });

    expect(show).toHaveBeenCalledWith(StorageFullModal, {
      level: StorageWarningLevel.Full,
      usedBytes: 9.6 * GiB,
      totalBytes: 10 * GiB,
      isAdmin: true,
      showReferral: true,
    });
  });

  it('passes isAdmin false for regular users', async () => {
    login(false);
    referral.loadReferral.mockResolvedValue(ok);

    await openStorageWarningModal(StorageWarningLevel.AlmostFull, { usedBytes: 8 * GiB, totalBytes: 10 * GiB });

    expect(show).toHaveBeenCalledWith(StorageFullModal, expect.objectContaining({ isAdmin: false }));
  });

  it('leaves out the referral when the tenant has no referral link', async () => {
    login(true);
    referral.loadReferral.mockResolvedValue({ status: 'none' });

    await openStorageWarningModal(StorageWarningLevel.AlmostFull, { usedBytes: 8 * GiB, totalBytes: 10 * GiB });

    expect(show).toHaveBeenCalledWith(StorageFullModal, expect.objectContaining({ showReferral: false }));
  });

  it('leaves out the referral (without looking it up) above 16 GB of storage', async () => {
    login(true);
    referral.loadReferral.mockResolvedValue(ok);

    await openStorageWarningModal(StorageWarningLevel.AlmostFull, { usedBytes: 80 * GiB, totalBytes: 100 * GiB });

    expect(referral.loadReferral).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(StorageFullModal, expect.objectContaining({ showReferral: false }));
  });
});
