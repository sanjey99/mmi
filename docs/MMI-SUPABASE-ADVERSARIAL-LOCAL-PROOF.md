# MMI Supabase adversarial local proof

This evidence is local-only. It must never be used against hosted Supabase,
shared credentials, Cron, migration history, or production data. The guarded
runner below is the only supported entrypoint; do not run any proof SQL file
directly because it requires the runner's local-proof database setting.

## Disposable pre-040 preparation

Prepare a separate disposable local Postgres/Supabase volume and a dedicated
database whose name matches `mmi_*proof*`, for example
`mmi_cofounder_proof`. The database must be restored from the observed hosted
catalog generation: the four `app_config` policies must use the legacy
`app_config_*_admin` names, `is_admin()` must exist, the seven assessor tables
must exist, and migration `040` must not have been applied. A normal full
`supabase db reset` is not suitable because it applies `040`; use a local clone
or restore that stops before the cutover and then load only the approved
hosted-catalog fixture. In particular, the local chain does not create the
four hosted-preexisting assessor tables `mmi_marking_criteria`,
`roleplay_end_criteria`, `roleplay_mark_domains`, and
`roleplay_response_rules`; synthesize only their approved catalog-compatible
definitions in this disposable volume before running the proof. Never use a
hosted connection string.

Before running the proof, set this exact database-level marker while connected
to the local Postgres instance as a database administrator:

```sql
CREATE DATABASE mmi_cofounder_proof;
ALTER DATABASE mmi_cofounder_proof
  SET app.mmi_adversarial_disposable = 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA';
```

Restore or prepare the disposable pre-040 catalog in that database after
creation. The runner checks this marker from `pg_db_role_setting`, the exact
database name, and local client/server addresses before it sets its session
acknowledgement or runs any fixture.

## Sole execution command

```bash
SUPABASE_LOCAL_MUTATION_TESTS=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA \
SUPABASE_LOCAL_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/mmi_cofounder_proof' \
bash scripts/run-local-cofounder-adversarial-proof.sh
```

The runner parses the URL once and uses only its canonical validated form. It
accepts only the exact loopback hostnames `127.0.0.1`, `localhost`, and `[::1]`
(the bracketed IPv6 URL form), with `postgres`/`postgresql` schemes and an
`mmi_*proof*` database name. It rejects all URL query parameters and fragments,
including libpq `host=` overrides, and suffix attacks such as
`127.0.0.1.evil.example` before invoking `psql`. `psql -X` prevents local
startup files from changing proof behavior.

The runner executes the following internal stages:

1. Run `supabase/tests/20260825_cofounder_preview_security_hostile_fixture.sql`
   with its locally scoped guard.
2. Run the separately approved reconciliation artifact, then run
   `supabase/tests/20260825_cofounder_preview_security_hostile_verify.sql`.
   It proves that table and direct-column grants granted to `PUBLIC`, `anon`,
   `authenticated`, and `service_role` do not survive for seven assessor
   content tables. It also creates one retained synthetic auth/profile row to
   prove that revoking direct `handle_new_user()` execution does not stop the
   auth trigger from creating profiles.
3. Deliberately re-poison `mmi_stations` for `service_role`, prove migration
   `040` fails and leaves legacy `is_admin()`/policy state unchanged, clean the
   poison, then apply `040` and run the final verifier.

The reconciliation keeps only authenticated `is_admin()` execution so legacy
policies remain valid during the staged boundary. It pins `handle_new_user()`,
`update_streak(uuid)`, and `is_admin()` to `pg_catalog, public`; direct calls
to the first two are revoked. Cutover `040` first rewrites the last legacy
`questions_write_admin` policy to an inline ownership check, then revokes all
runtime execution of `is_admin()` and `update_streak(uuid)`.

`040` refuses to proceed when any effective table or column privilege remains
on the assessor-content tables for `anon`, `authenticated`, or `service_role`.
Scoring RPC checks remain unchanged: they must be PostgreSQL-owned,
`SECURITY DEFINER`, fixed-path, and service-only. The Edge table surface is
exactly eight column privileges: profiles `id,is_admin` SELECT (two) and
app-config `key,value` SELECT/INSERT/UPDATE (six).

Neither fixture deletes proof rows or volumes. The local execution record must
include the commands, database identity, output, SQL SHA-256 hashes, and a
fresh catalog/ACL inspection before any hosted approval is requested. The
unchanged-data fingerprint includes existing `auth.users` rows as well as
public application tables, excluding only the retained synthetic proof UUID.
