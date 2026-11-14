-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "prompts_registry_model_id_idx" ON "prompts"("registry_model_id");
