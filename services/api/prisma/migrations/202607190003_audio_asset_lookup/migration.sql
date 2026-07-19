-- Authenticated audio delivery resolves the owning conversation from the
-- opaque stored asset reference on every request. Keep that authorization
-- lookup bounded as the transcript table grows.
CREATE INDEX "TranslationMessage_audioUrl_idx"
ON "TranslationMessage"("audioUrl");
