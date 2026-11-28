/**
PixelUnion fork invariants.

Upstream merges tend to silently undo small fork edits: a guard clause dropped while
re-applying upstream's bootstrap change, a queue missing from an ops script, a
permission re-enabled in the Android manifest. None of those break compilation, so
this spec asserts them directly against the source tree. When one of these fails
after a merge, re-apply the fork change rather than updating the expectation —
unless the fork change itself is being retired on purpose.
*/
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueueName } from 'src/enum.js';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(serverRoot, '..');

const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

const walk = (dir: string, extensions: string[]): string[] => {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...walk(fullPath, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      results.push(fullPath);
    }
  }
  return results;
};

const scriptFiles = (dir: string) =>
  readdirSync(join(repoRoot, dir))
    .map((file) => `${dir}/${file}`)
    .filter((path) => statSync(join(repoRoot, path)).isFile());

const readIfExists = (path: string) => (existsSync(join(repoRoot, path)) ? read(path) : '');

/** First statement that is not a comment or blank line. */
const firstStatement = (source: string) =>
  source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('//'));

describe('PixelUnion fork invariants', () => {
  describe('worker entrypoints', () => {
    const workers = ['api', 'maintenance', 'microservices'];

    it.each(workers)('%s.ts imports src/instrument.js first (Sentry must load before anything else)', (worker) => {
      expect(firstStatement(read(`server/src/workers/${worker}.ts`))).toBe("import 'src/instrument.js';");
    });

    it('api.ts only bootstraps when run as the main module (warm-compile-cache imports it)', () => {
      expect(read('server/src/workers/api.ts')).toMatch(/if \(import\.meta\.main\) \{\s*bootstrap\(\)/);
    });

    it.each(['maintenance', 'microservices'])(
      '%s.ts only bootstraps inside a worker thread (warm-compile-cache imports it)',
      (worker) => {
        const source = read(`server/src/workers/${worker}.ts`);
        expect(source).toContain("import { isMainThread } from 'node:worker_threads';");
        expect(source).toMatch(/if \(!isMainThread\) \{\s*bootstrap\(\)/);
      },
    );
  });

  describe('server/bin/warm-compile-cache.js', () => {
    const source = read('server/bin/warm-compile-cache.js');
    const block = source.match(/const modulesToWarm = \[([\s\S]*?)\];/)?.[1] ?? '';
    const modules = block
      .matchAll(/'([^']+)'(?:\s*,\s*'([^']+)')?/g)
      .map(([, a, b]) => (b ? `${a}/${b}` : a))
      .toArray();

    it('lists modules to warm', () => {
      expect(modules).toEqual(
        expect.arrayContaining([
          'app.module.js',
          'workers/api.js',
          'workers/maintenance.js',
          'workers/microservices.js',
        ]),
      );
    });

    it('only lists modules that exist in src', () => {
      for (const module of modules) {
        const sourcePath = join(serverRoot, 'src', module.replace(/\.js$/, '.ts'));
        expect(existsSync(sourcePath), `${module} -> ${relative(repoRoot, sourcePath)}`).toBe(true);
      }
    });

    it('does not import main.js (it runs a live-DB check at import time)', () => {
      expect(modules).not.toContain('main.js');
    });

    it('warms every worker entrypoint', () => {
      const workers = readdirSync(join(serverRoot, 'src', 'workers'))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
        .map((file) => `workers/${file.replace(/\.ts$/, '.js')}`);
      expect(modules).toEqual(expect.arrayContaining(workers));
    });
  });

  it('server/scripts/queue-stats.js QUEUE_NAMES matches the QueueName enum', () => {
    const source = read('server/scripts/queue-stats.js');
    const block = source.match(/const QUEUE_NAMES = \[([\s\S]*?)\];/)?.[1];
    expect(block, 'QUEUE_NAMES array not found').toBeDefined();
    const names = block!
      .replaceAll(/\/\/.*$/gm, '')
      .matchAll(/'([^']+)'/g)
      .map(([, name]) => name)
      .toArray();

    expect(names.toSorted()).toEqual(Object.values(QueueName).toSorted());
  });

  it('migrations ORDER contains the PixelUnion session token migration', () => {
    const order = read('server/src/schema/migrations/ORDER').split('\n');
    expect(order).toContain('1775200000000-AddPixelUnionSessionToken');
    expect(existsSync(join(serverRoot, 'src/schema/migrations/1775200000000-AddPixelUnionSessionToken.ts'))).toBe(true);
  });

  it('BlockedRouteGuard is registered before AuthGuard', () => {
    const source = read('server/src/app.module.ts');
    const blocked = source.indexOf('{ provide: APP_GUARD, useClass: BlockedRouteGuard }');
    const auth = source.indexOf('{ provide: APP_GUARD, useClass: AuthGuard }');
    expect(blocked).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(blocked);
  });

  it('BlockedRouteGuard is registered before MaintenanceAuthGuard in the maintenance worker', () => {
    const source = read('server/src/app.module.ts');
    const maintenanceModule = source.slice(
      source.lastIndexOf('@Module(', source.indexOf('export class MaintenanceModule')),
      source.indexOf('export class MaintenanceModule'),
    );
    const blocked = maintenanceModule.indexOf('{ provide: APP_GUARD, useClass: BlockedRouteGuard }');
    const auth = maintenanceModule.indexOf('{ provide: APP_GUARD, useClass: MaintenanceAuthGuard }');
    expect(blocked).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(blocked);
  });

  it.each([
    ['server/src/services/database-backup.service.ts', 'refuseDatabaseRestore();', 2],
    ['server/src/services/maintenance.service.ts', 'refuseDatabaseRestore();', 1],
    ['server/src/services/maintenance.service.ts', 'assertNotDatabaseRestoreAction(action.action);', 1],
    ['server/src/maintenance/maintenance-worker.service.ts', 'assertNotDatabaseRestoreAction(action.action);', 1],
    ['server/src/maintenance/maintenance-worker.service.ts', 'isDatabaseRestoreAction(action.action)', 1],
    ['server/src/maintenance/maintenance-worker.controller.ts', 'assertNotDatabaseRestoreAction(dto.action);', 1],
  ])('%s keeps the database restore refusal (%s)', (path, snippet, count) => {
    expect(read(path).split(snippet).length - 1).toBe(count);
  });

  it.each([
    ['server/src/services/user.service.ts', 'updateMe'],
    ['server/src/services/user-admin.service.ts', 'update'],
  ])('%s emits UserUpdate (PU-API tenant user sync)', (path) => {
    expect(read(path)).toContain("this.eventRepository.emit('UserUpdate'");
  });

  describe('mobile AndroidManifest.xml', () => {
    const manifest = read('mobile/android/app/src/main/AndroidManifest.xml');
    const activePermissions = manifest
      .replaceAll(/<!--[\s\S]*?-->/g, '')
      .matchAll(/<uses-permission\s+android:name="([^"]+)"/g)
      .map(([, name]) => name)
      .toArray();

    it('uses the PixelUnion app label', () => {
      expect(manifest).toMatch(/<application\s+android:label="PixelUnion"/);
    });

    it.each([
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ])('does not request %s', (permission) => {
      expect(activePermissions).not.toContain(permission);
    });
  });

  // Sentry loads first and sets up OpenTelemetry. With two copies of the API package, Immich
  // cannot register its meter provider after it, and the Prometheus metrics come out empty.
  it('pnpm-lock.yaml has one @opentelemetry/api version (Sentry and Immich share its global registry)', () => {
    const versions = new Set(read('pnpm-lock.yaml').match(/^ {2}'@opentelemetry\/api@[^':(]+/gm));
    expect([...versions]).toHaveLength(1);
  });

  describe('web branding', () => {
    it('does not import the Immich Logo component', () => {
      const offenders = walk(join(repoRoot, 'web', 'src'), ['.svelte', '.ts'])
        .filter((file) => /import\s*\{[^}]*\bLogo\b[^}]*\}\s*from\s*'@immich\/ui'/.test(readFileSync(file, 'utf8')))
        .map((file) => relative(repoRoot, file));

      expect(offenders).toEqual([]);
    });

    // Upstream v3.4 added web/static/icon.svg (the Immich logo) and links it from app.html.
    it('serves the PixelUnion icon as web/static/icon.svg (browser tab icon)', () => {
      expect(read('web/static/icon.svg')).toBe(read('web/static/pixelunion.svg'));
    });

    it('keeps the PixelUnion logo component', () => {
      expect(existsSync(join(repoRoot, 'web/src/lib/components/shared-components/pixelunion-logo.svelte'))).toBe(true);
    });
  });

  describe('i18n: PixelUnion keys', () => {
    /**
    Keys the fork added to i18n/en.json (`git diff v3.3.5 v3.3.5-pu7 -- i18n/en.json`).
    Pinned here rather than computed from git, so the test keeps working in shallow
    clones. When the fork adds a key, add it here and to every full fork locale.
    */
    const PIXELUNION_KEYS = [
      'admin.manage_subscription',
      'admin.plans',
      'admin.plans_storage_overview',
      'admin.storage_available',
      'admin.storage_usage_with_available',
      'admin.storage_used',
      'admin.upgrade_plan',
      'error_tracking_setting_description',
      'error_tracking_setting_title',
      'google_photos_migration',
      'google_photos_migration_already_uploaded',
      'google_photos_migration_available',
      'google_photos_migration_beta_notice',
      'google_photos_migration_cancel',
      'google_photos_migration_cancel_confirm',
      'google_photos_migration_cancel_failed',
      'google_photos_migration_cancel_help',
      'google_photos_migration_cancel_help_aria',
      'google_photos_migration_cancel_help_intro',
      'google_photos_migration_cancel_help_title',
      'google_photos_migration_cancel_help_warning',
      'google_photos_migration_completed_text',
      'google_photos_migration_completed_title',
      'google_photos_migration_create_button',
      'google_photos_migration_create_failed',
      'google_photos_migration_create_intro',
      'google_photos_migration_created',
      'google_photos_migration_delete',
      'google_photos_migration_delete_confirm',
      'google_photos_migration_delete_failed',
      'google_photos_migration_delete_upload_failed',
      'google_photos_migration_download_logs',
      'google_photos_migration_download_logs_failed',
      'google_photos_migration_failed_text',
      'google_photos_migration_failed_title',
      'google_photos_migration_file_too_large',
      'google_photos_migration_finish',
      'google_photos_migration_finish_confirm',
      'google_photos_migration_in_progress',
      'google_photos_migration_invalid_filename',
      'google_photos_migration_load_failed',
      'google_photos_migration_pending_text',
      'google_photos_migration_pending_title',
      'google_photos_migration_reauth_button',
      'google_photos_migration_reauth_description',
      'google_photos_migration_reauth_required',
      'google_photos_migration_reset',
      'google_photos_migration_reset_failed',
      'google_photos_migration_results',
      'google_photos_migration_running_duration_hint',
      'google_photos_migration_running_text',
      'google_photos_migration_running_title',
      'google_photos_migration_select_files',
      'google_photos_migration_start',
      'google_photos_migration_start_failed',
      'google_photos_migration_statistics',
      'google_photos_migration_subtitle',
      'google_photos_migration_takeout_help',
      'google_photos_migration_try_anyway',
      'google_photos_migration_upload_failed',
      'google_photos_migration_upload_intro',
      'google_photos_migration_uploaded',
      'invite_a_friend',
      'login_form_create_environment',
      'login_form_err_username_empty',
      'login_form_login_with_pixelunion',
      'login_form_no_account',
      'login_form_portal_failed',
      'login_form_register',
      'login_form_username',
      'login_form_username_hint',
      'login_welcome_subtitle',
      'login_welcome_title',
      'privacy_setting_description',
      'pu_account_security',
      'pu_account_security_description',
      'pu_email_address',
      'pu_email_address_description',
      'referral_description',
      'referral_heading',
      'referral_link',
      'referral_more_info',
      'referral_none',
      'referral_share_text',
      'referral_share_title',
      'referral_sidebar_link',
      'referral_title',
      'referral_unavailable',
      'sentry_consent_confirm',
      'sentry_consent_description',
      'sentry_consent_title',
      'storage_calculation_notice_button_text',
      'storage_calculation_notice_info',
      'storage_calculation_notice_title',
      'storage_warning_almost_full_body',
      'storage_warning_almost_full_title',
      'storage_warning_ask_admin_description',
      'storage_warning_ask_admin_title',
      'storage_warning_cleanup_description',
      'storage_warning_cleanup_title',
      'storage_warning_full_body',
      'storage_warning_full_title',
      'storage_warning_invite_description',
      'storage_warning_invite_title',
      'storage_warning_not_now',
      'storage_warning_sidebar_almost_full',
      'storage_warning_sidebar_full',
      'storage_warning_upgrade_description',
      'storage_warning_upgrade_title',
      'storage_warning_usage',
    ];

    /** Locales the fork translated in full. */
    const FULL_LOCALES = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv'];

    /**
    Known gaps in the full locales on v3.3.5-pu7. Each gap falls back to English at
    runtime. This list may only shrink: translate the key, then remove it here.
    */
    const KNOWN_GAPS: Record<string, string[]> = {
      de: [
        'admin.manage_subscription',
        'admin.plans',
        'admin.plans_storage_overview',
        'admin.storage_available',
        'admin.storage_usage_with_available',
        'admin.storage_used',
        'admin.upgrade_plan',
      ],
      es: [
        'storage_calculation_notice_button_text',
        'storage_calculation_notice_info',
        'storage_calculation_notice_title',
      ],
      pl: [
        'login_form_create_environment',
        'login_form_err_username_empty',
        'login_form_login_with_pixelunion',
        'login_form_no_account',
        'login_form_portal_failed',
        'login_form_register',
        'login_form_username',
        'login_form_username_hint',
        'login_welcome_subtitle',
        'login_welcome_title',
      ],
      pt: [
        'admin.manage_subscription',
        'admin.plans',
        'admin.plans_storage_overview',
        'admin.storage_available',
        'admin.storage_usage_with_available',
        'admin.storage_used',
        'admin.upgrade_plan',
      ],
      sv: [
        'admin.manage_subscription',
        'admin.plans',
        'admin.plans_storage_overview',
        'admin.storage_available',
        'admin.storage_usage_with_available',
        'admin.storage_used',
        'admin.upgrade_plan',
      ],
    };

    /**
    Locales the fork translated only in part: each must keep exactly the PixelUnion keys
    it carries today. (`ko.json` is not here: the fork only edited an upstream string.)
    */
    const PARTIAL_LOCALES: Record<string, string[]> = {
      da: [
        'error_tracking_setting_description',
        'error_tracking_setting_title',
        'privacy_setting_description',
        'pu_account_security',
        'pu_account_security_description',
        'pu_email_address',
        'pu_email_address_description',
        'sentry_consent_confirm',
        'sentry_consent_description',
        'sentry_consent_title',
        'storage_calculation_notice_button_text',
        'storage_calculation_notice_info',
        'storage_calculation_notice_title',
      ],
      dk: [
        'admin.manage_subscription',
        'admin.plans',
        'admin.plans_storage_overview',
        'admin.storage_available',
        'admin.storage_usage_with_available',
        'admin.storage_used',
        'admin.upgrade_plan',
        'storage_calculation_notice_button_text',
        'storage_calculation_notice_info',
        'storage_calculation_notice_title',
      ],
      pt_BR: [
        'login_form_create_environment',
        'login_form_err_username_empty',
        'login_form_login_with_pixelunion',
        'login_form_no_account',
        'login_form_portal_failed',
        'login_form_register',
        'login_form_username',
        'login_form_username_hint',
        'login_welcome_subtitle',
        'login_welcome_title',
      ],
    };

    const flatten = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => flatten(child, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    const localeKeys = (locale: string) => new Set(flatten(JSON.parse(read(`i18n/${locale}.json`))));

    it('en.json keeps every PixelUnion key (an upstream merge must not drop fork strings)', () => {
      const en = localeKeys('en');
      expect(PIXELUNION_KEYS.filter((key) => !en.has(key))).toEqual([]);
    });

    it.each(FULL_LOCALES)('%s.json keeps every PixelUnion key except its known gaps', (locale) => {
      const keys = localeKeys(locale);
      const gaps = KNOWN_GAPS[locale] ?? [];
      const missing = PIXELUNION_KEYS.filter((key) => !keys.has(key) && !gaps.includes(key));
      expect(missing, `${locale}.json lost PixelUnion translations; re-apply them from main`).toEqual([]);
      const filled = gaps.filter((key) => keys.has(key));
      expect(filled, `${locale}.json now translates these keys; remove them from KNOWN_GAPS`).toEqual([]);
    });

    it.each(Object.entries(PARTIAL_LOCALES))('%s.json keeps its PixelUnion keys', (locale, expected) => {
      const keys = localeKeys(locale);
      expect(expected.filter((key) => !keys.has(key))).toEqual([]);
    });

    it('lists only PixelUnion keys in the gap and partial-locale lists', () => {
      const listed = [...Object.values(KNOWN_GAPS), ...Object.values(PARTIAL_LOCALES)].flat();
      expect(listed.filter((key) => !PIXELUNION_KEYS.includes(key))).toEqual([]);
    });
  });

  describe('iOS app identity', () => {
    // The PixelUnion iOS identity (bundle IDs, team, App Group, product name, BGTask
    // identifiers) is not on main yet: it lives on the unmerged feat/ios-app-store-release
    // branch, so only the part that holds today is guarded here.
    const entitlements = walk(join(repoRoot, 'mobile', 'ios'), ['.entitlements']).filter(
      (file) => !file.includes('/Pods/'),
    );

    it('finds the iOS entitlements files', () => {
      expect(entitlements.length).toBeGreaterThan(0);
    });

    it.each(entitlements.map((file) => relative(repoRoot, file)))(
      '%s claims no webcredentials: domain (passkeys stay off in the fork)',
      (file) => {
        expect(read(file)).not.toContain('webcredentials:');
      },
    );
  });

  describe('web build config defaults', () => {
    // web/svelte.config.js holds these today; upstream v3.4 moves the config to
    // web/vite.config.ts. Either home is fine, neither is not.
    const candidates = ['web/svelte.config.js', 'web/vite.config.ts'].filter((path) =>
      existsSync(join(repoRoot, path)),
    );
    const sources = candidates.map((path) => read(path)).join('\n');

    it('defaults PUBLIC_API_URL to the PixelUnion API (web talks to PU-API without extra env)', () => {
      expect(sources, `checked ${candidates.join(', ')}`).toMatch(
        /process\.env\.PUBLIC_API_URL\s*=\s*process\.env\.PUBLIC_API_URL\s*\|\|\s*'https:\/\/api\.prd\.tech\.pixelunion\.eu'/,
      );
    });

    it('defaults PUBLIC_SENTRY_DSN to the PixelUnion Sentry project (opt-in web error tracking)', () => {
      expect(sources, `checked ${candidates.join(', ')}`).toMatch(
        /process\.env\.PUBLIC_SENTRY_DSN\s*=\s*process\.env\.PUBLIC_SENTRY_DSN\s*\|\|\s*'https:\/\/[^']+\.ingest\.de\.sentry\.io\/\d+'/,
      );
    });
  });

  it.each(['build-mobile.yml', 'docs-build.yml', 'test.yml', 'draft-release.yml'])(
    '.github/workflows/%s stays deleted (upstream workflow the fork disabled)',
    (workflow) => {
      expect(existsSync(join(repoRoot, '.github', 'workflows', workflow))).toBe(false);
    },
  );

  describe('ops scripts parse', () => {
    const jsScripts = [...scriptFiles('server/scripts'), ...scriptFiles('server/bin')].filter((path) =>
      path.endsWith('.js'),
    );
    const shellScripts = [
      ...scriptFiles('server/bin').filter((path) => !path.endsWith('.js')),
      'misc/release/pu-version-bump.sh',
    ];
    const hasBash = spawnSync('bash', ['--version']).status === 0;

    it.each(jsScripts)('node --check %s', (path) => {
      const result = spawnSync(process.execPath, ['--check', join(repoRoot, path)], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    });

    it.skipIf(!hasBash).each(shellScripts)('bash -n %s (skipped when bash is not installed)', (path) => {
      const result = spawnSync('bash', ['-n', join(repoRoot, path)], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    });
  });

  it('server/Dockerfile warms the Node compile cache at build time (fast API cold starts)', () => {
    const dockerfile = read('server/Dockerfile');
    expect(dockerfile).toContain('ENV NODE_COMPILE_CACHE=/usr/src/app/server/.compile-cache');
    expect(dockerfile).toMatch(
      /RUN node server\/bin\/warm-compile-cache\.js && \\\s*chmod -R a\+rX \/usr\/src\/app\/server\/\.compile-cache/,
    );
  });

  describe('FUTO Backups and passkeys stay out of the fork', () => {
    it.each([
      ['server/src/app.module.ts', 'OrchestrationApiModule.forRootAsync'],
      ['server/src/services/index.ts', 'FutoBackupsService'],
      ['server/package.json', '@futo-org/backups-orchestrator-api'],
      ['server/Dockerfile', 'restic'],
      ['web/src/lib/components/layouts/AdminPageLayout.svelte', 'ImmichBackups'],
      ['web/src/lib/components/shared-components/side-bar/BottomInfo.svelte', 'ImmichBackups'],
      ['web/src/routes/(user)/user-settings/UserSettingsList.svelte', 'UserPasskeyList'],
    ])('%s does not contain %s (drop it when merging upstream)', (path, needle) => {
      expect(readIfExists(path)).not.toContain(needle);
    });

    it('web/src/routes/admin/backups does not exist (FUTO Backups admin pages)', () => {
      expect(existsSync(join(repoRoot, 'web/src/routes/admin/backups'))).toBe(false);
    });
  });
});
