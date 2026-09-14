-- CreateEnum
CREATE TYPE "OperatorStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "operator_auth_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_auth_sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "operator_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_auth_accounts" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT 'credential',
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_auth_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_auth_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" UUID NOT NULL,
    "external_auth_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "OperatorStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "operator_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "operator_auth_users_email_key" ON "operator_auth_users"("email");

-- CreateIndex
CREATE INDEX "operator_auth_sessions_userId_idx" ON "operator_auth_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "operator_auth_sessions_token_key" ON "operator_auth_sessions"("token");

-- CreateIndex
CREATE INDEX "operator_auth_accounts_userId_idx" ON "operator_auth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "operator_auth_accounts_issuer_accountId_key" ON "operator_auth_accounts"("issuer", "accountId");

-- CreateIndex
CREATE INDEX "operator_auth_verifications_identifier_idx" ON "operator_auth_verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "operators_external_auth_id_key" ON "operators"("external_auth_id");

-- CreateIndex
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");

-- CreateIndex
CREATE INDEX "operators_status_idx" ON "operators"("status");

-- CreateIndex
CREATE INDEX "operators_created_at_idx" ON "operators"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_operator_id_idx" ON "audit_logs"("operator_id");

-- AddForeignKey
ALTER TABLE "operator_auth_sessions" ADD CONSTRAINT "operator_auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "operator_auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_auth_accounts" ADD CONSTRAINT "operator_auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "operator_auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_external_auth_id_fkey" FOREIGN KEY ("external_auth_id") REFERENCES "operator_auth_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
