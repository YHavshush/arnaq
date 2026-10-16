-- The account balance after each transaction, as the bank states it (cents). Null when unknown (rows
-- imported before this existed). Used for the real balance on the Prognose.
-- (drizzle-kit also wanted to recreate transactions_suggested_category_fk because 0004's snapshot was made
-- before that key got its hand-written ON DELETE SET NULL (suggested_category_id); the key stays as it is.)
ALTER TABLE "transactions" ADD COLUMN "balance_after" bigint;
