import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import type { MockData } from '#test/common/data.ts';
import { factory } from '#test/common/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { locale as i18nLocale, register } from 'svelte-i18n';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import StorageSpace from './StorageSpace.svelte';

// The shared test setup renders translation keys; these specs assert the English strings.
register('en', () => import('#i18n/en.json'));

beforeAll(async () => {
  await i18nLocale.set('en');
});

const GiB = 1024 ** 3;

const load = () => Promise.resolve({});

const setServerDisk = (data: MockData, diskUseRaw: number, diskSizeRaw: number) => {
  Object.assign(data.storage, { diskUseRaw, diskSizeRaw, diskAvailableRaw: diskSizeRaw - diskUseRaw });
};

const login = (data: MockData, quotaUsageInBytes: number | null, quotaSizeInBytes: number | null) => {
  authManager.setUser(factory.user({ quotaUsageInBytes, quotaSizeInBytes }));
  authManager.setPreferences(factory.preferences());
  setServerDisk(data, 100 * GiB, 1000 * GiB);
};

// The sidebar widget sits in the page's only root element; everything the tests look at is inside it.
const container = () => document.body;

// PixelUnion: storage is labelled with the familiar decimal unit names (GB, not GiB), while the
// maths stays 1024-based. The meter shows the user's quota, or the server disk for quota-less users.
describe('StorageSpace (PixelUnion)', () => {
  test.for([
    { used: 0, total: 5 * GiB, label: '0 B of 5 GB used' },
    { used: 1.5 * GiB, total: 5 * GiB, label: '1.5 GB of 5 GB used' },
    { used: 512 * 1024 ** 2, total: 16 * GiB, label: '512 MB of 16 GB used' },
    { used: 250 * GiB, total: 1024 * GiB, label: '250 GB of 1 TB used' },
  ])('labels quota usage in GB-style units: $label', async ({ used, total, label }, { data, render }) => {
    login(data, used, total);

    await render(StorageSpace, load);

    await expect.element(page.getByText(label, { exact: true })).toBeInTheDocument();
  });

  test('shows a full quota as used equal to the total', async ({ data, render }) => {
    login(data, 5 * GiB, 5 * GiB);

    await render(StorageSpace, load);

    await expect.element(page.getByText('5 GB of 5 GB used', { exact: true })).toBeInTheDocument();
  });

  test('shows the server disk for a user without a quota', async ({ data, render }) => {
    login(data, null, null);
    setServerDisk(data, 100.5 * GiB, 2048 * GiB);

    await render(StorageSpace, load);

    await expect.element(page.getByText('100.5 GB of 2 TB used', { exact: true })).toBeInTheDocument();
  });

  test('uses GB in the hover title too, with up to three decimals', async ({ data, render }) => {
    login(data, 1.25 * GiB, 5 * GiB);

    await render(StorageSpace, load);

    await expect.element(page.getByTitle('1.25 GB of 5 GB used', { exact: true })).toBeInTheDocument();
    expect(container().querySelector('[title]')).toHaveAttribute('title', '1.25 GB of 5 GB used');
  });

  test('never shows binary unit names (KiB/MiB/GiB/TiB)', async ({ data, render }) => {
    login(data, 1.5 * GiB, 2048 * GiB);

    await render(StorageSpace, load);

    await expect.element(page.getByText('1.5 GB of 2 TB used', { exact: true })).toBeInTheDocument();
    expect(container().textContent).not.toMatch(/[KMGT]iB/);
    expect(container().getHTML()).not.toMatch(/[KMGT]iB/);
  });

  test.for([
    { used: 79, colour: null },
    { used: 80, colour: 'bg-warning' },
    { used: 94, colour: 'bg-warning' },
    { used: 95, colour: 'bg-danger' },
    { used: 100, colour: 'bg-danger' },
  ])(
    'colours the meter at the storage popup thresholds: $used% → $colour',
    async ({ used, colour }, { data, render }) => {
      login(data, used * GiB, 100 * GiB);

      await render(StorageSpace, load);

      await expect.element(page.getByText(`${used} GB of 100 GB used`, { exact: true })).toBeInTheDocument();
      const warning = container().querySelector('.bg-warning');
      const danger = container().querySelector('.bg-danger');
      expect(warning !== null).toBe(colour === 'bg-warning');
      expect(danger !== null).toBe(colour === 'bg-danger');
    },
  );
});
