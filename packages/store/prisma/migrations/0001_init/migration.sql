-- CreateTable
CREATE TABLE "edge_event" (
    "seq" BIGSERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "scanner" TEXT,
    "sent_at" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "stored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edge_event_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "outcome" (
    "id" BIGSERIAL NOT NULL,
    "session" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "decided_at" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge" (
    "key" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charge_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "review_answer" (
    "item_id" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "minutes" DOUBLE PRECISION NOT NULL,
    "at" BIGINT NOT NULL,
    "operator" TEXT NOT NULL,

    CONSTRAINT "review_answer_pkey" PRIMARY KEY ("item_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edge_event_id_key" ON "edge_event"("id");

-- CreateIndex
CREATE INDEX "edge_event_site_sent_at_idx" ON "edge_event"("site", "sent_at");

-- CreateIndex
CREATE INDEX "outcome_site_plate_idx" ON "outcome"("site", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "outcome_session_kind_key" ON "outcome"("session", "kind");

-- CreateIndex
CREATE INDEX "charge_status_idx" ON "charge"("status");
