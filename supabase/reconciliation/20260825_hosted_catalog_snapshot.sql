-- READ-ONLY hosted catalog snapshot for the MMI cofounder preview.
-- This script selects metadata only. It does not read application/auth rows
-- and contains no DDL, DML, user-defined function invocation, or
-- migration-history write.

WITH
relation_rows AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS relation_name,
    c.relkind::text AS relation_kind,
    pg_get_userbyid(c.relowner) AS owner_name,
    c.relrowsecurity AS row_security,
    c.relforcerowsecurity AS force_row_security,
    COALESCE(c.relacl::text, '') AS acl
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
),
column_rows AS (
  SELECT
    table_schema,
    table_name,
    ordinal_position,
    column_name,
    data_type,
    udt_schema,
    udt_name,
    is_nullable,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
),
constraint_rows AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    con.conname AS constraint_name,
    con.contype::text AS constraint_type,
    pg_get_constraintdef(con.oid, true) AS definition,
    con.convalidated AS validated
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
),
index_rows AS (
  SELECT schemaname, tablename, indexname, indexdef
  FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public'
),
policy_rows AS (
  SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
),
table_grant_rows AS (
  SELECT grantor, grantee, table_schema, table_name, privilege_type, is_grantable
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
),
column_grant_rows AS (
  SELECT grantor, grantee, table_schema, table_name, column_name, privilege_type, is_grantable
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
),
routine_rows AS (
  SELECT
    n.nspname AS schema_name,
    p.proname AS routine_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS result_type,
    pg_get_userbyid(p.proowner) AS owner_name,
    l.lanname AS language_name,
    p.prokind::text AS routine_kind,
    p.prosecdef AS security_definer,
    p.provolatile::text AS volatility,
    COALESCE(p.proconfig, ARRAY[]::text[]) AS configuration,
    COALESCE(p.proacl::text, '') AS acl,
    md5(pg_get_functiondef(p.oid)) AS definition_md5
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
),
trigger_rows AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    t.tgname AS trigger_name,
    t.tgenabled::text AS enabled,
    pn.nspname AS function_schema,
    p.proname AS function_name,
    pg_get_triggerdef(t.oid, true) AS definition
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
  JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'auth')
    AND NOT t.tgisinternal
),
enum_rows AS (
  SELECT
    n.nspname AS schema_name,
    t.typname AS type_name,
    e.enumsortorder,
    e.enumlabel
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  JOIN pg_catalog.pg_enum AS e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
),
extension_rows AS (
  SELECT extname, extversion, n.nspname AS schema_name
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
),
default_acl_rows AS (
  SELECT
    pg_get_userbyid(d.defaclrole) AS owner_name,
    COALESCE(n.nspname, '') AS schema_name,
    d.defaclobjtype::text AS object_type,
    COALESCE(d.defaclacl::text, '') AS acl
  FROM pg_catalog.pg_default_acl AS d
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
),
schema_privilege_rows AS (
  SELECT
    role_name,
    has_schema_privilege(role_name, 'public', 'USAGE') AS has_usage,
    has_schema_privilege(role_name, 'public', 'CREATE') AS has_create
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
),
snapshot AS (
  SELECT jsonb_build_object(
    'database_version', current_setting('server_version'),
    'relations', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.schema_name, r.relation_name)
      FROM relation_rows AS r
    ), '[]'::jsonb),
    'columns', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name, c.ordinal_position)
      FROM column_rows AS c
    ), '[]'::jsonb),
    'constraints', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name, c.constraint_name)
      FROM constraint_rows AS c
    ), '[]'::jsonb),
    'indexes', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.tablename, i.indexname)
      FROM index_rows AS i
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename, p.policyname)
      FROM policy_rows AS p
    ), '[]'::jsonb),
    'table_grants', COALESCE((
      SELECT jsonb_agg(to_jsonb(g) ORDER BY g.table_name, g.grantee, g.privilege_type, g.grantor, g.is_grantable)
      FROM table_grant_rows AS g
    ), '[]'::jsonb),
    'column_grants', COALESCE((
      SELECT jsonb_agg(to_jsonb(g) ORDER BY g.table_name, g.column_name, g.grantee, g.privilege_type, g.grantor, g.is_grantable)
      FROM column_grant_rows AS g
    ), '[]'::jsonb),
    'routines', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.routine_name, r.identity_arguments)
      FROM routine_rows AS r
    ), '[]'::jsonb),
    'triggers', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.schema_name, t.table_name, t.trigger_name)
      FROM trigger_rows AS t
    ), '[]'::jsonb),
    'enums', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.type_name, e.enumsortorder)
      FROM enum_rows AS e
    ), '[]'::jsonb),
    'extensions', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.extname)
      FROM extension_rows AS e
    ), '[]'::jsonb),
    'default_acls', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_name, d.schema_name, d.object_type)
      FROM default_acl_rows AS d
    ), '[]'::jsonb),
    'public_schema_privileges', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.role_name)
      FROM schema_privilege_rows AS s
    ), '[]'::jsonb),
    'migration_relation', to_regclass('supabase_migrations.schema_migrations')::text,
    'cron_relation', to_regclass('cron.job')::text
  ) AS value
)
SELECT
  timezone('utc', statement_timestamp()) AS captured_at_utc,
  value AS catalog_snapshot,
  md5(value::text) AS catalog_snapshot_md5
FROM snapshot;

-- If migration_relation above is non-null, run this second read-only query:
-- SELECT version, name
-- FROM supabase_migrations.schema_migrations
-- ORDER BY version;

-- If cron_relation above is non-null, run this second read-only query:
-- SELECT jobid, schedule, md5(command) AS command_md5,
--        octet_length(command) AS command_bytes,
--        database, username, active, jobname
-- FROM cron.job
-- ORDER BY jobid;
