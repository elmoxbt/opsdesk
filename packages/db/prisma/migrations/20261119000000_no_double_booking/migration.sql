-- A technician can never hold two committed jobs at overlapping times.
--
-- The API checks for overlaps first (to return a helpful 409 naming the clash),
-- but a check-then-write in application code races: two dispatchers can both
-- pass the check and both commit. This exclusion constraint makes Postgres the
-- final arbiter, atomically, under any concurrency.
--
-- Prisma's schema language can't express exclusion constraints, so this lives
-- in a hand-written migration. Prisma ignores constraints it doesn't model, so
-- later `migrate dev` runs leave it in place (an integration test asserts it exists).

-- btree_gist lets a GiST index combine "=" on a uuid with "&&" on a range.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_technician_no_overlap"
  EXCLUDE USING gist (
    "technicianId" WITH =,
    tsrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  )
  WHERE (
    "technicianId" IS NOT NULL
    AND "scheduledStart" IS NOT NULL
    AND "scheduledEnd" IS NOT NULL
    AND "status" IN ('SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS')
  );
