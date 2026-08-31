#!/usr/bin/env bash
# Run the MMI ACL adversarial proof against a disposable local database only.
set -euo pipefail

ack='I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'
if [[ "${SUPABASE_LOCAL_MUTATION_TESTS:-}" != "$ack" ]]; then
  echo 'Refusing to mutate: set SUPABASE_LOCAL_MUTATION_TESTS to the exact acknowledgement.' >&2
  exit 64
fi

database_url="${SUPABASE_LOCAL_DB_URL:-}"
if ! validated_database="$(node -e "
  const value = new URL(process.argv[1]);
  const allowedHosts = ['127.0.0.1', 'localhost', '[::1]'];
  const databaseName = decodeURIComponent(value.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(value.protocol)
    || !allowedHosts.includes(value.hostname)
    || value.search !== ''
    || value.hash !== ''
    || !/^mmi_[a-z0-9_]*proof[a-z0-9_]*$/.test(databaseName)
  ) process.exit(1);
  value.pathname = '/' + databaseName;
  console.log(value.toString() + '\t' + databaseName);
" "$database_url")"; then
  echo 'Refusing to mutate: SUPABASE_LOCAL_DB_URL must be a query/fragment-free postgres loopback URL for an mmi_*proof* database.' >&2
  exit 64
fi
IFS=$'\t' read -r canonical_database_url database_name <<< "$validated_database"
if [[ -z "$canonical_database_url" || ! "$database_name" =~ ^mmi_[a-z0-9_]*proof[a-z0-9_]*$ ]]; then
  echo 'Refusing to mutate: SUPABASE_LOCAL_DB_URL did not produce a canonical disposable database identity.' >&2
  exit 64
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# -q suppresses command-status lines such as SET, so captured preflight and
# rollback scalars contain only the SELECT result. ON_ERROR_STOP still prints
# errors to stderr and makes every failed psql invocation non-zero.
psql_args=("$canonical_database_url" -X -q -v ON_ERROR_STOP=1)

# This check runs before setting the session acknowledgement or loading any
# fixture. The URL identifies a loopback endpoint, while the database marker
# makes the mutable target explicit. Docker's bridge/NAT addresses are local
# private ranges, so accept those alongside IPv4/IPv6 loopback on both ends.
local_identity="$(psql "${psql_args[@]}" -Atc "
  SELECT CASE WHEN
    current_database() = '$database_name'
    AND inet_client_addr() IS NOT NULL
    AND inet_server_addr() IS NOT NULL
    AND (
      inet_client_addr() <<= '127.0.0.0/8'::inet
      OR inet_client_addr() <<= '::1/128'::inet
      OR inet_client_addr() <<= '10.0.0.0/8'::inet
      OR inet_client_addr() <<= '172.16.0.0/12'::inet
      OR inet_client_addr() <<= '192.168.0.0/16'::inet
    )
    AND (
      inet_server_addr() <<= '127.0.0.0/8'::inet
      OR inet_server_addr() <<= '::1/128'::inet
      OR inet_server_addr() <<= '10.0.0.0/8'::inet
      OR inet_server_addr() <<= '172.16.0.0/12'::inet
      OR inet_server_addr() <<= '192.168.0.0/16'::inet
    )
    AND EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS setting
      JOIN pg_database AS database ON database.oid = setting.setdatabase
      WHERE database.datname = '$database_name'
        AND setting.setrole = 0
        AND setting.setconfig @> ARRAY['app.mmi_adversarial_disposable=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA']
    )
  THEN 'approved' ELSE 'refused' END;
")"
if [[ "$local_identity" != 'approved' ]]; then
  echo 'Refusing to mutate: database identity, local connection address, or disposable database marker is missing.' >&2
  exit 64
fi

psql_args+=( -c "SET app.local_mmi_adversarial_proof = '$ack'" )

# Pre-040 catalog preparation: begin from a disposable database restored to
# the observed hosted catalog generation, with 040 absent from migration
# history. A normal db reset is unsuitable because it has already applied 040.
preflight="$(psql "${psql_args[@]}" -Atc "
  SELECT CASE WHEN
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_config') = 4
    AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_config' AND policyname = 'app_config_insert_admin')
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_config' AND policyname = 'app_config_insert_admin_non_secret')
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_config' AND policyname = 'app_config_read_admin')
    AND to_regprocedure('public.is_admin()') IS NOT NULL
    AND (SELECT count(*) FROM (VALUES
      ('mmi_stations'), ('mmi_sub_questions'), ('roleplay_stations'),
      ('mmi_marking_criteria'), ('roleplay_end_criteria'),
      ('roleplay_mark_domains'), ('roleplay_response_rules')
    ) AS required(name) WHERE to_regclass('public.' || required.name) IS NOT NULL) = 7
  THEN 'ready' ELSE 'not-ready' END;
")"
if [[ "$preflight" != "ready" ]]; then
  echo 'Refusing local proof: pre-040 catalog preparation is missing the hosted-compatible policy/function/assessor-table set; see docs/MMI-SUPABASE-ADVERSARIAL-LOCAL-PROOF.md.' >&2
  exit 64
fi
if [[ "$(psql "${psql_args[@]}" -Atc "SELECT to_regclass('supabase_migrations.schema_migrations')")" != "" ]] \
  && [[ "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260825004000'")" != "0" ]]; then
  echo 'Refusing local proof: migration 040 is already recorded; restore a disposable pre-040 catalog.' >&2
  exit 64
fi

snapshot() {
  psql "${psql_args[@]}" -Atc "
    SELECT c.relname || '=' || md5(query_to_xml(
      format('SELECT * FROM public.%I ORDER BY ctid', c.relname), false, false, ''
    )::text)
    FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'profiles'
    ORDER BY c.relname;
     SELECT 'profiles=' || md5(query_to_xml(
       'SELECT * FROM public.profiles WHERE id <> ''00000000-0000-0000-0000-000000000403'' ORDER BY ctid', false, false, ''
     )::text);
     SELECT 'auth-users=' || md5(query_to_xml(
       'SELECT * FROM auth.users WHERE id <> ''00000000-0000-0000-0000-000000000403'' ORDER BY ctid', false, false, ''
     )::text);
  "
  if [[ "$(psql "${psql_args[@]}" -Atc "SELECT to_regclass('supabase_migrations.schema_migrations')")" != "" ]]; then
    psql "${psql_args[@]}" -Atc "SELECT 'migration-history=' || md5(query_to_xml('SELECT * FROM supabase_migrations.schema_migrations ORDER BY ctid', false, false, '')::text)"
  else
    echo 'migration-history=absent'
  fi
  if [[ "$(psql "${psql_args[@]}" -Atc "SELECT to_regclass('cron.job')")" != "" ]]; then
    psql "${psql_args[@]}" -Atc "SELECT 'cron=' || md5(query_to_xml('SELECT * FROM cron.job ORDER BY jobid', false, false, '')::text)"
  else
    echo 'cron=absent'
  fi
}

before="$(snapshot)"
psql "${psql_args[@]}" -f "$root_dir/supabase/tests/20260825_cofounder_preview_security_hostile_fixture.sql"
psql "${psql_args[@]}" -f "$root_dir/supabase/reconciliation/20260825_cofounder_preview_security.sql"
psql "${psql_args[@]}" -f "$root_dir/supabase/tests/20260825_cofounder_preview_security_hostile_verify.sql"

# 040 must fail closed after a direct service_role re-poisoning attempt.
psql "${psql_args[@]}" -c 'GRANT SELECT ON TABLE public.mmi_stations TO service_role'
if psql "${psql_args[@]}" -f "$root_dir/supabase/migrations/20260825004000_cofounder_preview_privilege_cutover.sql"; then
  echo 'Expected 040 to fail closed after service_role ACL re-poisoning.' >&2
  exit 1
fi
rollback_proof="$(psql "${psql_args[@]}" -Atc "
  SELECT CASE WHEN
    has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
    AND EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'questions'
        AND policyname = 'questions_write_admin'
        AND coalesce(qual, '') ~ 'is_admin[[:space:]]*\('
    )
  THEN 'rolled-back' ELSE 'changed' END;
")"
if [[ "$rollback_proof" != "rolled-back" ]]; then
  echo 'Cutover rollback proof failed: 040 left an effect after its deliberate failure.' >&2
  exit 1
fi
psql "${psql_args[@]}" -c 'REVOKE ALL ON TABLE public.mmi_stations FROM service_role'
psql "${psql_args[@]}" -c 'REVOKE SELECT (id), INSERT (id), UPDATE (id), REFERENCES (id) ON TABLE public.mmi_stations FROM service_role'
psql "${psql_args[@]}" -f "$root_dir/supabase/migrations/20260825004000_cofounder_preview_privilege_cutover.sql"
psql "${psql_args[@]}" -f "$root_dir/supabase/tests/20260825_cofounder_preview_security_cutover_verify.sql"

after="$(snapshot)"
if [[ "$before" != "$after" ]]; then
  echo 'Application data, including existing auth users and excluding only the retained synthetic auth/profile proof row, or migration history changed.' >&2
  exit 1
fi

echo 'Local adversarial ACL proof passed; synthetic auth/profile row was retained.'
