// drizzle-kit configuration (W0-04 schema evolution): `npm run migrate:generate` writes a numbered SQL file from
// the schema diff for review; the file is then completed by hand (triggers, grants, functions) and committed.
// `drizzle-kit push` is forbidden. Migrations are applied only by `npm run migrate` (server/src/db/migrate.ts).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/src/db/schema/index.ts',
  out: './server/drizzle',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
});
