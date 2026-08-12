-- Add a per-employee contract sequence (1st, 2nd, 3rd ...) to Contract.
ALTER TABLE "Contract" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1;

-- Backfill existing contracts in chronological order (startDate then createdAt).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "employeeId" ORDER BY "startDate" ASC, "createdAt" ASC) AS rn
  FROM "Contract"
)
UPDATE "Contract" SET "sequence" = ranked.rn FROM ranked WHERE "Contract".id = ranked.id;
