-- RUNSHOW Supabase pre-migration diagnostic
-- Read-only: queries PostgreSQL metadata only; it does not read application rows.
-- Run manually in the SQL Editor of the EXISTING Supabase project. No schema changes are made.

-- 1. Connection context (no credentials or application records)
SELECT current_database() AS database_name,
       current_user AS executing_role,
       current_setting('server_version') AS postgres_version;

-- 2. Non-system schemas
SELECT n.nspname AS schema_name,
       pg_catalog.pg_get_userbyid(n.nspowner) AS schema_owner
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname;

-- 3. Tables, partitioned tables, views and foreign tables, including RLS state
SELECT n.nspname AS schema_name,
       c.relname AS object_name,
       CASE c.relkind
         WHEN 'r' THEN 'table'
         WHEN 'p' THEN 'partitioned table'
         WHEN 'v' THEN 'view'
         WHEN 'm' THEN 'materialized view'
         WHEN 'f' THEN 'foreign table'
       END AS object_type,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, c.relname;

-- 4. Candidate application tables for identity, events and operations
-- Names only; this query never reads table contents.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'
  AND c.relname ~* '(user|profile|event|membership|invitation|invite|registration|ticket|task|incident|analytic|snapshot|recommend|risk|team|attendance|campaign|outreach)'
ORDER BY n.nspname, c.relname;

-- 5. Column definitions (types, defaults, nullability and generated/identity metadata)
SELECT cols.table_schema,
       cols.table_name,
       cols.ordinal_position,
       cols.column_name,
       cols.data_type,
       cols.udt_name,
       cols.is_nullable,
       cols.column_default,
       cols.is_identity,
       cols.identity_generation,
       cols.is_generated,
       cols.generation_expression
FROM information_schema.columns AS cols
WHERE cols.table_schema <> 'information_schema'
  AND cols.table_schema !~ '^pg_'
ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position;

-- 6. Primary keys, foreign keys, unique/check/exclusion constraints
-- Definitions include composite key columns and referenced relations.
SELECT n.nspname AS schema_name,
       tbl.relname AS table_name,
       con.conname AS constraint_name,
       CASE con.contype
         WHEN 'p' THEN 'primary key'
         WHEN 'f' THEN 'foreign key'
         WHEN 'u' THEN 'unique'
         WHEN 'c' THEN 'check'
         WHEN 'x' THEN 'exclusion'
         ELSE con.contype::text
       END AS constraint_type,
       pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
       con.convalidated AS validated,
       con.condeferrable AS deferrable,
       con.condeferred AS initially_deferred
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS tbl ON tbl.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
WHERE n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, tbl.relname, con.conname;

-- 7. Index definitions and health metadata
SELECT n.nspname AS schema_name,
       tbl.relname AS table_name,
       idx.relname AS index_name,
       ix.indisprimary AS is_primary,
       ix.indisunique AS is_unique,
       ix.indisvalid AS is_valid,
       ix.indisready AS is_ready,
       pg_catalog.pg_get_indexdef(idx.oid) AS index_definition
FROM pg_catalog.pg_index AS ix
JOIN pg_catalog.pg_class AS tbl ON tbl.oid = ix.indrelid
JOIN pg_catalog.pg_class AS idx ON idx.oid = ix.indexrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
WHERE n.nspname <> 'information_schema'
  AND n.nspname !~ '^pg_'
ORDER BY n.nspname, tbl.relname, idx.relname;

-- 8. RLS policies and their access conditions
SELECT schemaname AS schema_name,
       tablename AS table_name,
       policyname AS policy_name,
       permissive,
       roles,
       cmd AS command,
       qual AS using_expression,
       with_check AS with_check_expression
FROM pg_catalog.pg_policies
WHERE schemaname <> 'information_schema'
  AND schemaname !~ '^pg_'
ORDER BY schemaname, tablename, policyname;

-- 9. Function metadata relevant to authentication/data management
-- Function bodies are intentionally omitted to avoid exposing embedded literals/secrets.
SELECT ns.nspname AS schema_name,
       p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_catalog.pg_get_function_result(p.oid) AS return_type,
       lang.lanname AS language,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = p.pronamespace
JOIN pg_catalog.pg_language AS lang ON lang.oid = p.prolang
WHERE ns.nspname <> 'information_schema'
  AND ns.nspname !~ '^pg_'
  AND p.prokind IN ('f', 'p')
  AND (p.proname ~* '(auth|profile|user|event|member|invite|register|ticket|task|incident|trigger|handle|updated|audit|policy|rls|jwt|claim|signup)'
       OR ns.nspname = 'auth')
ORDER BY ns.nspname, p.proname, arguments;

-- 10. Non-internal triggers and their definitions (function source is not displayed)
SELECT ns.nspname AS schema_name,
       tbl.relname AS table_name,
       trg.tgname AS trigger_name,
       proc.proname AS function_name,
       CASE trg.tgenabled
         WHEN 'O' THEN 'origin/local'
         WHEN 'D' THEN 'disabled'
         WHEN 'R' THEN 'replica'
         WHEN 'A' THEN 'always'
       END AS enabled_mode,
       pg_catalog.pg_get_triggerdef(trg.oid, true) AS trigger_definition
FROM pg_catalog.pg_trigger AS trg
JOIN pg_catalog.pg_class AS tbl ON tbl.oid = trg.tgrelid
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
JOIN pg_catalog.pg_proc AS proc ON proc.oid = trg.tgfoid
WHERE NOT trg.tgisinternal
  AND ns.nspname <> 'information_schema'
  AND ns.nspname !~ '^pg_'
ORDER BY ns.nspname, tbl.relname, trg.tgname;

-- 11. Non-system user-defined types and sequences that may conflict with migrations
SELECT ns.nspname AS schema_name,
       typ.typname AS object_name,
       CASE typ.typtype
         WHEN 'e' THEN 'enum'
         WHEN 'd' THEN 'domain'
         WHEN 'r' THEN 'range'
         WHEN 'm' THEN 'multirange'
         ELSE typ.typtype::text
       END AS object_type
FROM pg_catalog.pg_type AS typ
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = typ.typnamespace
WHERE typ.typrelid = 0
  AND typ.typtype IN ('e', 'd', 'r', 'm')
  AND ns.nspname <> 'information_schema'
  AND ns.nspname !~ '^pg_'
ORDER BY ns.nspname, typ.typname;

SELECT ns.nspname AS schema_name,
       seq.relname AS sequence_name,
       pg_catalog.pg_get_userbyid(seq.relowner) AS owner
FROM pg_catalog.pg_class AS seq
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = seq.relnamespace
WHERE seq.relkind = 'S'
  AND ns.nspname <> 'information_schema'
  AND ns.nspname !~ '^pg_'
ORDER BY ns.nspname, seq.relname;

-- 12. Effective object grants relevant to anonymous, authenticated, and server access
SELECT table_schema AS schema_name,
       table_name AS object_name,
       grantee,
       privilege_type,
       is_grantable
FROM information_schema.table_privileges
WHERE table_schema <> 'information_schema'
  AND table_schema !~ '^pg_'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role', current_user)
ORDER BY table_schema, table_name, grantee, privilege_type;

SELECT table_schema AS schema_name,
       table_name AS object_name,
       column_name,
       grantee,
       privilege_type,
       is_grantable
FROM information_schema.column_privileges
WHERE table_schema <> 'information_schema'
  AND table_schema !~ '^pg_'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role', current_user)
ORDER BY table_schema, table_name, column_name, grantee, privilege_type;

SELECT routine_schema AS schema_name,
       routine_name AS function_name,
       grantee,
       privilege_type,
       is_grantable
FROM information_schema.routine_privileges
WHERE routine_schema <> 'information_schema'
  AND routine_schema !~ '^pg_'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role', current_user)
ORDER BY routine_schema, routine_name, grantee, privilege_type;

-- 13. Schema access and configured default privileges (security configuration only)
SELECT ns.nspname AS schema_name,
       pg_catalog.pg_get_userbyid(ns.nspowner) AS schema_owner,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_namespace AS ns
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(ns.nspacl, pg_catalog.acldefault('n', ns.nspowner))
) AS acl
WHERE ns.nspname <> 'information_schema'
  AND ns.nspname !~ '^pg_'
ORDER BY ns.nspname, acl.grantee, acl.privilege_type;

SELECT COALESCE(ns.nspname, '<global>') AS schema_name,
       pg_catalog.pg_get_userbyid(d.defaclrole) AS grantor_role,
       d.defaclobjtype AS object_type_code,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_default_acl AS d
LEFT JOIN pg_catalog.pg_namespace AS ns ON ns.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
WHERE ns.nspname IS NULL
   OR (ns.nspname <> 'information_schema' AND ns.nspname !~ '^pg_')
ORDER BY schema_name, grantor_role, object_type_code, acl.grantee, acl.privilege_type;

-- 14. View definitions show the exact exposed column/query surface; no rows are read.
SELECT ns.nspname AS schema_name,
       c.relname AS view_name,
       CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' END AS view_type,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       pg_catalog.pg_get_viewdef(c.oid, true) AS definition
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND ns.nspname <> 'information_schema'
  AND ns.nspname !~ '^pg_'
ORDER BY ns.nspname, c.relname;

