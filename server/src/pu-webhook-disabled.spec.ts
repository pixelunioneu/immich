/**
 * PixelUnion: the webhook workflow action is disabled. The core plugin no longer ships it
 * (so the method is pruned on plugin sync, cascading any existing workflow steps), and the
 * httpRequest host function refuses every call in case any other plugin tries to use it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

type ManifestMethod = { name: string; hostFunctions?: boolean; allowedHosts?: string[] };

describe('PixelUnion webhook action disabled', () => {
  it('the core plugin manifest has no webhook method', () => {
    const { methods } = JSON.parse(read('packages/plugin-core/manifest.json')) as { methods: ManifestMethod[] };
    expect(methods.map(({ name }) => name)).not.toContain('webhook');
  });

  it('no core plugin method declares outbound hosts', () => {
    const { methods } = JSON.parse(read('packages/plugin-core/manifest.json')) as { methods: ManifestMethod[] };
    expect(methods.filter((method) => (method.allowedHosts ?? []).length > 0)).toEqual([]);
  });

  it('the core plugin source does not call httpRequest', () => {
    expect(read('packages/plugin-core/src/index.ts')).not.toContain('httpRequest');
  });

  it('the httpRequest host function always refuses', () => {
    const source = read('server/src/services/workflow-execution.service.ts');
    expect(source).toContain('Promise.reject(new Error(PU_HTTP_REQUEST_DISABLED))');
    expect(source).not.toMatch(/\bfetch\(/);
  });
});
