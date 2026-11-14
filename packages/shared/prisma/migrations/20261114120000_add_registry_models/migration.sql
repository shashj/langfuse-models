-- CreateTable
CREATE TABLE "registry_models" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "context_window" INTEGER,
    "max_output_tokens" INTEGER,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "default_params" JSONB,
    "pricing_model_id" TEXT,

    CONSTRAINT "registry_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registry_models_project_id_idx" ON "registry_models"("project_id");

-- CreateIndex
CREATE INDEX "registry_models_pricing_model_id_idx" ON "registry_models"("pricing_model_id");

-- CreateIndex
CREATE UNIQUE INDEX "registry_models_project_id_provider_model_id_key" ON "registry_models"("project_id", "provider", "model_id");

-- AddForeignKey
ALTER TABLE "registry_models" ADD CONSTRAINT "registry_models_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry_models" ADD CONSTRAINT "registry_models_pricing_model_id_fkey" FOREIGN KEY ("pricing_model_id") REFERENCES "models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
