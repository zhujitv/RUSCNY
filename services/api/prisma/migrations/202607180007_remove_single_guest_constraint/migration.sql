-- Multi-participant rooms intentionally allow any number of non-host speakers.
-- This removes the legacy one-to-one partial unique index while preserving all
-- participant rows and the per-user/per-guest identity uniqueness constraints.
DROP INDEX IF EXISTS "Participant_one_active_guest_per_conversation";
