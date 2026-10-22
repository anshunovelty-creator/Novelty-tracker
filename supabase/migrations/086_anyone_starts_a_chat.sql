-- ============================================================
-- 086_anyone_starts_a_chat.sql
-- Team chat is no longer Admin-started only (agreed 2026-10-21): anyone
-- with a login can start a conversation with one teammate or several,
-- and add its people. Threads stay private to their participants, Admin
-- included — the SELECT policies from 059/060 are untouched.
--
-- Adding people is allowed to whoever started the thread (and Admin, as
-- before). The check goes through a SECURITY DEFINER function for the
-- same reason as is_conversation_participant (060): the starter can't SEE
-- their new conversation until their own participant row exists, so a
-- plain subquery on conversations would always come back empty.
-- ============================================================

CREATE OR REPLACE FUNCTION started_conversation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id AND started_by = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION started_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION started_conversation(UUID) TO authenticated;

DROP POLICY IF EXISTS "Admin can start a conversation" ON conversations;
CREATE POLICY "Anyone can start a conversation as themselves"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (started_by = auth.uid());

DROP POLICY IF EXISTS "Admin can add participants" ON conversation_participants;
CREATE POLICY "The starter or Admin adds participants"
  ON conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (dept_is_super_admin() OR started_conversation(conversation_id));
