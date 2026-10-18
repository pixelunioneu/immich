/**
 * PixelUnion fork invariants.
 *
 * Upstream merges tend to silently undo small fork edits: a guard clause dropped while
 * re-applying upstream's bootstrap change, a queue missing from an ops script, a
 * permission re-enabled in the Android manifest. None of those break compilation, so
 * this spec asserts them directly against the source tree. When one of these fails
 * after a merge, re-apply the fork change rather than updating the expectation —
 * unless the fork change itself is being retired on purpose.
 */
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

  describe('web branding', () => {
    it('does not import the Immich Logo component', () => {
      const offenders = walk(join(repoRoot, 'web', 'src'), ['.svelte', '.ts'])
        .filter((file) => /import\s*\{[^}]*\bLogo\b[^}]*\}\s*from\s*'@immich\/ui'/.test(readFileSync(file, 'utf8')))
        .map((file) => relative(repoRoot, file));

      expect(offenders).toEqual([]);
    });

    it('keeps the PixelUnion logo component', () => {
      expect(existsSync(join(repoRoot, 'web/src/lib/components/shared-components/pixelunion-logo.svelte'))).toBe(true);
    });
  });
});
