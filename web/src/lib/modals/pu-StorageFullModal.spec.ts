import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { PU_BILLING_PORTAL_URL } from '#lib/utils/pu-api.ts';
import { openStorageWarningModal } from '#lib/utils/storage-warning-modal.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { StorageWarningLevel } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { locale as i18nLocale, register } from 'svelte-i18n';
import { expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import StorageFullModal from './StorageFullModal.svelte';

// The shared test setup renders translation keys; these specs assert the English strings.
register('en', () => import('#i18n/en.json'));

beforeAll(async () => {
  await i18nLocale.set('en');
});

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

const renderModal = async (props: Partial<Props> = {}) => {
  const onClose = vi.fn();
  await render(StorageFullModal, {
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

const link = (name: RegExp) => page.getByRole('link', { name });
const text = (value: string) => page.getByText(value, { exact: true });

// PixelUnion: at 80% and 95% of the storage, a popup explains what is going on and offers a way out:
// upgrade (tenant owner) or ask the owner, invite a friend for extra storage, or clean up.
describe('StorageFullModal (PixelUnion)', () => {
  test('says the storage is almost full, with the usage in GB and percent', async () => {
    await renderModal({ level: StorageWarningLevel.AlmostFull, usedBytes: 8.5 * GiB, totalBytes: 10 * GiB });

    await expect.element(text('Your storage is almost full')).toBeInTheDocument();
    await expect.element(text('8.5 GB of 10 GB used')).toBeInTheDocument();
    await expect.element(text("You've used 85% of your storage.")).toBeInTheDocument();
    await expect.element(text("When it's full, new photos and videos can't be uploaded.")).toBeInTheDocument();
  });

  test('says the storage is full, capping the percentage at 100', async () => {
    await renderModal({ level: StorageWarningLevel.Full, usedBytes: 11 * GiB, totalBytes: 10 * GiB });

    await expect.element(text('Your storage is full')).toBeInTheDocument();
    await expect.element(text("You've used 100% of your storage.")).toBeInTheDocument();
    await expect
      .element(text("New photos and videos can't be uploaded until there is space again."))
      .toBeInTheDocument();
  });

  test('lets the tenant owner upgrade in the Stripe portal, in a new tab', async () => {
    const { onClose } = await renderModal({ isAdmin: true });

    const upgrade = link(/Upgrade your plan/);
    await expect.element(upgrade).toHaveAttribute('href', PU_BILLING_PORTAL_URL);
    await expect.element(upgrade).toHaveAttribute('target', '_blank');
    await expect.element(page.getByText('Ask for more storage')).not.toBeInTheDocument();

    upgrade.element().addEventListener('click', (event) => event.preventDefault());
    await upgrade.click();
    expect(onClose).toHaveBeenCalled();
  });

  test('tells regular users to ask their administrator instead of linking to billing', async () => {
    await renderModal({ isAdmin: false });

    await expect.element(text('Ask for more storage')).toBeInTheDocument();
    await expect.element(page.getByText('Upgrade your plan')).not.toBeInTheDocument();
    expect(document.querySelector(`a[href="${CSS.escape(PU_BILLING_PORTAL_URL)}"]`)).toBeNull();
  });

  test('offers the referral page only when asked to', async () => {
    await renderModal({ showReferral: true });
    await expect.element(link(/Invite a friend/)).toHaveAttribute('href', '/referral');
  });

  test('hides the referral option when not asked to', async () => {
    await renderModal({ showReferral: false });
    await expect.element(text('Your storage is almost full')).toBeInTheDocument();
    await expect.element(page.getByText('Invite a friend')).not.toBeInTheDocument();
  });

  test('always offers clean-up via the utilities page', async () => {
    await renderModal({ isAdmin: false });
    await expect.element(link(/Clean up/)).toHaveAttribute('href', '/utilities');
  });

  test('closes on "Not now"', async () => {
    const { onClose } = await renderModal();

    await page.getByRole('button', { name: 'Not now' }).click();

    expect(onClose).toHaveBeenCalled();
  });
});

// The helper both the automatic check and the sidebar button use to open the popup.
describe('openStorageWarningModal (PixelUnion)', () => {
  let show: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    show = vi.spyOn(modalManager, 'show').mockResolvedValue(undefined as never);
    referral.loadReferral.mockReset();
  });

  afterEach(() => {
    show.mockRestore();
  });

  const login = (isAdmin: boolean) => {
    authManager.setUser(factory.user({ isAdmin }));
    authManager.setPreferences(factory.preferences());
  };

  const ok = { status: 'ok', referral: { referral_id: 'abc', referral_url: 'https://pixelunion.eu/?ref=abc' } };

  test('opens the popup with the usage, admin flag and referral for an eligible tenant', async () => {
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

  test('passes isAdmin false for regular users', async () => {
    login(false);
    referral.loadReferral.mockResolvedValue(ok);

    await openStorageWarningModal(StorageWarningLevel.AlmostFull, { usedBytes: 8 * GiB, totalBytes: 10 * GiB });

    expect(show).toHaveBeenCalledWith(StorageFullModal, expect.objectContaining({ isAdmin: false }));
  });

  test('leaves out the referral when the tenant has no referral link', async () => {
    login(true);
    referral.loadReferral.mockResolvedValue({ status: 'none' });

    await openStorageWarningModal(StorageWarningLevel.AlmostFull, { usedBytes: 8 * GiB, totalBytes: 10 * GiB });

    expect(show).toHaveBeenCalledWith(StorageFullModal, expect.objectContaining({ showReferral: false }));
  });

  test('leaves out the referral (without looking it up) above 16 GB of storage', async () => {
    login(true);
    referral.loadReferral.mockResolvedValue(ok);

    await openStorageWarningModal(StorageWarningLevel.AlmostFull, { usedBytes: 80 * GiB, totalBytes: 100 * GiB });

    expect(referral.loadReferral).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(StorageFullModal, expect.objectContaining({ showReferral: false }));
  });
});
