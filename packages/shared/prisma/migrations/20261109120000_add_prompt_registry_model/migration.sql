-- AlterTable
ALTER TABLE "prompts" ADD COLUMN "registry_model_id" TEXT;
ALTER TABLE "prompts" ADD COLUMN "model_params" JSONB;

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_registry_model_id_fkey" FOREIGN KEY ("registry_model_id") REFERENCES "registry_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
