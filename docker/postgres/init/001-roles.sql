-- W0-04 database roles (persistence-and-artifact-store.md, "Immutability" > Database roles).
-- Runs once, as the compose superuser, when the data volume is created. Local, synthetic credentials only;
-- production roles and credentials come from the D10 custody runbook, never from this file.
--
--   rai_owner    owns the schema; runs migrations (DATABASE_MIGRATE_URL); still subject to every trigger
--   rai_app      the Fastify process (DATABASE_URL); SELECT/INSERT everywhere, UPDATE only where a migration grants it, no DELETE, no DDL
--   rai_operator operator commands (DATABASE_OPERATOR_URL): rai_app plus DELETE on idempotency_key (granted by the migration)
--
-- Table-level grants are written by the migration that creates each table (rai-web/server/drizzle/), so that a
-- new table never inherits a wider grant than its spec row states.

CREATE ROLE rai_owner LOGIN PASSWORD 'rai_owner';
CREATE ROLE rai_app LOGIN PASSWORD 'rai_app';
CREATE ROLE rai_operator LOGIN PASSWORD 'rai_operator';

-- The operator role inherits everything the application role may do, plus what migrations grant it directly.
GRANT rai_app TO rai_operator;

ALTER DATABASE rai OWNER TO rai_owner;

-- Connected to the "rai" database (docker-entrypoint runs this file with --dbname "$POSTGRES_DB").
-- The public schema is owned by pg_database_owner in Postgres 15+, so rai_owner (the database owner) may create in it;
-- nobody else may create objects, and the two runtime roles only use it.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO rai_app, rai_operator;
