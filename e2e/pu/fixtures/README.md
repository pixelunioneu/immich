# Upgrade-path fixture

`v3.3.5-pu7-schema.sql` is a dump of the database of a fresh fork server at release
`v3.3.5-pu7`: the full schema, the extensions and the migration history
(`kysely_migrations`, `migration_overrides`), without the rows loaded at boot (geodata,
the core plugin and its workflows). `src/specs/pu/server/pu-upgrade-path.e2e-spec.ts`
loads it into a scratch database and runs `immich-admin db-migrate` and
`immich-admin schema-check` from the server under test against it.

It is a fixed baseline: the schema a hosted tenant has when the next release is deployed.
Do not regenerate it to make the upgrade spec pass. A failure means migrations from the
last release do not apply cleanly, which is what the spec is there to catch.

Regenerate it only when a new fork release becomes the baseline, and rename the file to
that release:

```bash
git checkout <release tag>                 # e.g. v3.3.5-pu8
cd e2e
./pu/compose.sh build immich-server
./pu/compose.sh up -d --wait --renew-anon-volumes --force-recreate immich-server
./pu/fixtures/dump-schema.sh pu/fixtures/<release>-schema.sql
./pu/compose.sh down -v
```

Then point the spec at the new file. Dump from a fresh stack: the specs add users and
sessions.
