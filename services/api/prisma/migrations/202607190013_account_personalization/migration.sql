ALTER TABLE "User"
ADD COLUMN "avatarPreset" TEXT NOT NULL DEFAULT 'jade',
ADD COLUMN "interfaceLanguage" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN "autoPlayTranslationAudio" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "translationPlaybackSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1;
