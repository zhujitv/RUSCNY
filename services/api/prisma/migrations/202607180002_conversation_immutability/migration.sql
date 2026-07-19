-- Enforce the central isolation invariant below the API layer as defense in depth.
CREATE OR REPLACE FUNCTION prevent_conversation_rebinding()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
     OR NEW."contactId" IS DISTINCT FROM OLD."contactId" THEN
    RAISE EXCEPTION 'Conversation ownerId/contactId are immutable after creation';
  END IF;
  IF OLD."status" = 'ENDED' AND NEW."status" <> 'ENDED' THEN
    RAISE EXCEPTION 'An ended Conversation cannot be reopened';
  END IF;
  IF OLD."status" = 'EXPIRED' AND NEW."status" <> 'EXPIRED' THEN
    RAISE EXCEPTION 'An expired Conversation cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Conversation_prevent_rebinding"
BEFORE UPDATE ON "Conversation"
FOR EACH ROW
EXECUTE FUNCTION prevent_conversation_rebinding();

-- A room is intentionally one Host plus one customer. The partial unique
-- index closes the check-then-insert race when two guests join concurrently.
CREATE UNIQUE INDEX "Participant_one_active_guest_per_conversation"
ON "Participant" ("conversationId")
WHERE "role" = 'GUEST' AND "removedAt" IS NULL;
