import { defineConfig } from "drizzle-kit";

// Only used for `drizzle-kit generate` (and studio). Migrations are applied by src/db/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/budget" },
});
