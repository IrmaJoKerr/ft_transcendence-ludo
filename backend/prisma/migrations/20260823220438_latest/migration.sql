-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted', 'blocked');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('online', 'playing', 'offline');

-- CreateEnum
CREATE TYPE "PlayerColor" AS ENUM ('RED', 'GREEN', 'YELLOW', 'BLUE');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('PVP', 'PVE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "highestRating" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "winStreak" INTEGER NOT NULL DEFAULT 0,
    "bestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "botWins" INTEGER NOT NULL DEFAULT 0,
    "humanWins" INTEGER NOT NULL DEFAULT 0,
    "avatarStyle" TEXT NOT NULL DEFAULT 'bottts',
    "avatarPhoto" BYTEA,
    "avatarPhotoContentType" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'offline',
    "disconnectCount" INTEGER NOT NULL DEFAULT 0,
    "reconnectCount" INTEGER NOT NULL DEFAULT 0,
    "achFirstBlood" BOOLEAN NOT NULL DEFAULT false,
    "achOnFire" BOOLEAN NOT NULL DEFAULT false,
    "achDiceMaster" BOOLEAN NOT NULL DEFAULT false,
    "achBabySteps" BOOLEAN NOT NULL DEFAULT false,
    "achTheDiceLoveMe" BOOLEAN NOT NULL DEFAULT false,
    "achTactician" BOOLEAN NOT NULL DEFAULT false,
    "achMaster" BOOLEAN NOT NULL DEFAULT false,
    "achGrandBotMaster" BOOLEAN NOT NULL DEFAULT false,
    "achWorldChampion" BOOLEAN NOT NULL DEFAULT false,
    "achLoveTheMachine" BOOLEAN NOT NULL DEFAULT false,
    "achft_Transcendence" BOOLEAN NOT NULL DEFAULT false,
    "achSpeedDemon" BOOLEAN NOT NULL DEFAULT false,
    "achUnstoppable" BOOLEAN NOT NULL DEFAULT false,
    "achSteadyDefender" BOOLEAN NOT NULL DEFAULT false,
    "achMercilessAttacker" BOOLEAN NOT NULL DEFAULT false,
    "pveGameStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'COMPLETED',
    "gameType" "GameType" NOT NULL DEFAULT 'PVP',
    "inviteCode" TEXT,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameParticipant" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "color" "PlayerColor" NOT NULL,
    "rank" INTEGER NOT NULL,
    "piecesCaptured" INTEGER NOT NULL DEFAULT 0,
    "piecesInGoal" INTEGER NOT NULL DEFAULT 0,
    "clashDefends" INTEGER NOT NULL DEFAULT 0,
    "clashAttacksWon" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GameParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_inviteCode_key" ON "Game"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_game_id_user_id_key" ON "GameParticipant"("game_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_game_id_color_key" ON "GameParticipant"("game_id", "color");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userId_friendId_key" ON "Friendship"("userId", "friendId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_friendId_fkey" FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

