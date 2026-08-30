-- AlterTable
ALTER TABLE "auth_accounts" ADD COLUMN "issuer" TEXT NOT NULL DEFAULT 'credential';

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_issuer_accountId_key" ON "auth_accounts"("issuer", "accountId");
