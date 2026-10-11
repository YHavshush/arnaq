import { getDb } from "./index";

// createDb() applies pending migrations on open, so opening the DB is enough.
getDb();
console.log("Database is up to date.");
