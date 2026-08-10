-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Position_name_key" ON "Position"("name");

-- SeedDefaultDepartments
INSERT INTO "Department" ("id", "name", "isActive", "createdAt", "updatedAt") VALUES
('aaaaaaa1-0000-0000-0000-000000000001', 'Technology', true, now(), now()),
('aaaaaaa1-0000-0000-0000-000000000002', 'Human Resources', true, now(), now()),
('aaaaaaa1-0000-0000-0000-000000000003', 'Finance', true, now(), now()),
('aaaaaaa1-0000-0000-0000-000000000004', 'Marketing', true, now(), now()),
('aaaaaaa1-0000-0000-0000-000000000005', 'Operations', true, now(), now());

-- SeedDefaultPositions
INSERT INTO "Position" ("id", "name", "isActive", "createdAt", "updatedAt") VALUES
('aaaaaaa2-0000-0000-0000-000000000001', 'Staff', true, now(), now()),
('aaaaaaa2-0000-0000-0000-000000000002', 'Manager', true, now(), now()),
('aaaaaaa2-0000-0000-0000-000000000003', 'Director', true, now(), now()),
('aaaaaaa2-0000-0000-0000-000000000004', 'Non-Staff', true, now(), now());
