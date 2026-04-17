-- ============================================================================
-- EnQaZ Engine Session RPCs — Missing Functions Migration
-- Run this ONCE in Supabase SQL Editor.
--
-- Context: enginesecurity.js calls 4 RPCs for session lifecycle management.
-- rpc_acquire_engine_lock already exists (hint confirmed in error message).
-- This file creates the 3 missing ones:
--   1. rpc_heartbeat_engine     — keeps session alive every 5s
--   2. rpc_takeover_engine_session — atomically steals the active session
--   3. rpc_deactivate_engine_session — clean shutdown on page unload
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. rpc_heartbeat_engine(p_session_id)
--
-- Called every 5 seconds by the Engine to prove the session is still alive.
-- Logic:
--   - Finds the engine_sessions row matching this session_id AND is_active=true
--   - Updates last_ping to NOW()
--   - If not found (session was revoked by a takeover), returns status='revoked'
--   - If found, returns status='ok'
--
-- JS expects: { status: 'ok' } or { status: 'revoked' }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_heartbeat_engine(p_session_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows_updated INT;
BEGIN
    UPDATE public.engine_sessions
    SET    last_ping = NOW()
    WHERE  session_id::TEXT = p_session_id
      AND  is_active = TRUE;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        -- No active row found for this session_id → session was revoked
        RAISE NOTICE '[HEARTBEAT] Session % not found or revoked.', p_session_id;
        RETURN jsonb_build_object('status', 'revoked');
    END IF;

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_heartbeat_engine(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_heartbeat_engine(TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. rpc_takeover_engine_session(p_session_id)
--
-- Called when an operator clicks "Take Over" on the conflict resolution screen.
-- Logic:
--   1. Deactivates ALL currently active sessions (is_active → false)
--   2. Inserts a fresh session row for the new session_id as is_active=true
--   3. Returns status='success'
--
-- This is the atomic handoff — no window exists where two sessions are active.
-- JS expects: { status: 'success' }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_takeover_engine_session(p_session_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
    -- Step 1: Kill any currently active sessions
    UPDATE public.engine_sessions
    SET    is_active  = FALSE,
           last_ping  = NOW()
    WHERE  is_active = TRUE;

    -- Step 2: Insert the new session as the sole active session
    INSERT INTO public.engine_sessions (session_id, started_at, last_ping, is_active)
    VALUES (p_session_id::UUID, NOW(), NOW(), TRUE)
    ON CONFLICT DO NOTHING; -- safety: if UUID somehow collides, don't crash

    RAISE NOTICE '[TAKEOVER] Session % is now the sole active Engine session.', p_session_id;
    RETURN jsonb_build_object('status', 'success');
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_takeover_engine_session(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_takeover_engine_session(TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. rpc_deactivate_engine_session(p_session_id)
--
-- Called on page unload (beforeunload event) for clean shutdown.
-- Logic:
--   - Sets is_active=false for this specific session_id only
--   - Does NOT touch other sessions (safe for takeover scenarios)
--   - Returns status='deactivated' or status='not_found' (idempotent)
--
-- JS does not wait on the response (fire-and-forget via .then())
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_deactivate_engine_session(p_session_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows_updated INT;
BEGIN
    UPDATE public.engine_sessions
    SET    is_active = FALSE,
           last_ping = NOW()
    WHERE  session_id::TEXT = p_session_id
      AND  is_active = TRUE;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    RAISE NOTICE '[DEACTIVATE] Session % cleanly deactivated.', p_session_id;
    RETURN jsonb_build_object('status', 'deactivated');
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_deactivate_engine_session(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_deactivate_engine_session(TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — Run after migration to confirm all 4 RPCs exist
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT proname, pronargs
-- FROM   pg_proc
-- WHERE  proname IN (
--     'rpc_acquire_engine_lock',
--     'rpc_heartbeat_engine',
--     'rpc_takeover_engine_session',
--     'rpc_deactivate_engine_session'
-- );
-- Expected: 4 rows returned.
