// Gives the app's database role (kasboek_app) a login with a random password and writes the app's
// connection string to .env.hosted (git-ignored, mode 600). Neither password is printed anywhere.
//   OWNER_URL=<connection string of the owner role, postgres> npm run db:app-role
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

async function main() {
  const owner = new URL(process.env.OWNER_URL?.trim() ?? "");
  const app = new URL(owner.toString());
  // The pooler wants "<role>.<project ref>", a direct connection just "<role>".
  const ref = owner.username.includes(".") ? owner.username.slice(owner.username.indexOf(".")) : "";
  app.username = `kasboek_app${ref}`;
  const password = randomBytes(32).toString("hex"); // hex only: safe inside a SQL literal and a URL
  app.password = password;
  if (!app.searchParams.has("sslmode")) app.searchParams.set("sslmode", "require");

  const admin = postgres(owner.toString(), { max: 1, prepare: false, ssl: "require" });
  await admin.unsafe(`alter role kasboek_app login password '${password}'`);
  await admin.end();

  // Prove it works, and that it is the restricted role.
  const check = postgres(app.toString(), { max: 1, prepare: false, ssl: "require" });
  const [row] = await check`
    select current_user::text as who,
           (select rolbypassrls or rolsuper from pg_roles where rolname = current_user) as privileged`;
  await check.end();
  if (row.who !== "kasboek_app" || row.privileged) throw new Error("unexpected role");

  writeFileSync(".env.hosted", `DATABASE_URL=${app.toString()}\n`, { mode: 0o600 });
  console.log("Done: kasboek_app can log in. The connection string is in .env.hosted (not shown).");
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.name : "unknown error");
  process.exit(1);
});
