-- Fingerprint the original request independently from provider output so a
-- FAILED attempt can be retried under the same idempotency key without letting
-- that key be reused for different text/audio.
ALTER TABLE "TranslationMessage" ADD COLUMN "requestHash" TEXT;
