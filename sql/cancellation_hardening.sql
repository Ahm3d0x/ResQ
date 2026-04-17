-- ============================================================================
-- EnQaZ Cancellation Pipeline — DB Hardening Migration
-- Run this script ONCE in your Supabase SQL editor.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Unique index on incident_logs(incident_id, action)
-- This is the ultimate guard against duplicate log entries.
-- The in-app logIncidentAction() check is a fast-fail optimization;
-- this constraint is the authoritative idempotency lock.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_log_action
    ON public.incident_logs (incident_id, action);

-- NOTE: If you already have duplicate rows, clean them first:
-- DELETE FROM incident_logs a USING incident_logs b
-- WHERE a.id > b.id AND a.incident_id = b.incident_id AND a.action = b.action;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Standardize incident_status_enum — drop 'CANCELLED' (1L) if present
-- The authoritative spelling is 'cancelled' (2L) throughout the system.
-- Supabase enums cannot be easily altered; check what values currently exist.
-- If your enum already ONLY has 'cancelled', this step is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this to verify:
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'incident_status_enum'::regtype;
--
-- If 'CANCELLED' (1L) exists alongside 'cancelled' (2L), migrate any rows first:
UPDATE public.incidents
    SET status = 'cancelled'
    WHERE status::text = 'CANCELLED';
-- Then remove from enum (requires superuser / Supabase dashboard):
-- ALTER TYPE incident_status_enum RENAME VALUE 'CANCELLED' TO '__deprecated_CANCELLED';
-- Or simply leave the enum but enforce 2L at application level (done in JS fixes).


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Atomic Cancellation RPC
-- This is called by engineincidentlog.js::processIncidentCancellation().
-- It runs in a single DB transaction:
--   1. Locks the incident row for update (prevents concurrent cancel)
--   2. Validates status is cancellable  
--   3. Updates incident status → 'cancelled'
--   4. Releases the ambulance → 'available'
--   5. Clears incident assignment references
--   6. Inserts the 'cancelled' log (protected by uq_incident_log_action)
-- Returns TRUE if cancelled, FALSE if already cancelled/completed (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_cancel_incident_atomic(
    target_incident_id BIGINT,
    requester_source   TEXT DEFAULT 'system'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_incident        public.incidents%ROWTYPE;
    v_ambulance_id    BIGINT;
BEGIN
    -- ── 1. Lock the incident row. SKIP LOCKED means if another TX is already
    --        processing this cancel, we return FALSE immediately (no wait/deadlock).
    SELECT * INTO v_incident
    FROM   public.incidents
    WHERE  id = target_incident_id
    FOR UPDATE SKIP LOCKED;

    -- Row was locked by another cancel in-flight → already being handled
    IF NOT FOUND THEN
        RAISE NOTICE '[ENGINE_LOCK] Incident #% is locked by another process. Skipping.', target_incident_id;
        RETURN FALSE;
    END IF;

    -- ── 2. Idempotency guard: already in a terminal state
    IF v_incident.status IN ('cancelled', 'completed') THEN
        RAISE NOTICE '[CANCEL_FLOW] Incident #% already in terminal state: %. Skipping.', target_incident_id, v_incident.status;
        RETURN FALSE;
    END IF;

    v_ambulance_id := v_incident.assigned_ambulance_id;

    -- ── 3. Update incident: set status, clear assignment refs, stamp resolved_at
    UPDATE public.incidents
    SET
        status               = 'cancelled',
        assigned_ambulance_id = NULL,
        assigned_hospital_id  = NULL,
        resolved_at           = NOW(),
        updated_at            = NOW()
    WHERE id = target_incident_id;

    -- ── 4. Release the ambulance (if one was assigned)
    IF v_ambulance_id IS NOT NULL THEN
        UPDATE public.ambulances
        SET
            status     = 'available',
            updated_at = NOW()
        WHERE id = v_ambulance_id
          AND status NOT IN ('available', 'offline'); -- Don't override if already released
    END IF;

    -- ── 5. Write the cancellation log.
    --    ON CONFLICT DO NOTHING: the unique index on (incident_id, action)
    --    silently swallows a duplicate cancel log. True idempotency.
    INSERT INTO public.incident_logs (incident_id, action, performed_by, note)
    VALUES (
        target_incident_id,
        'cancelled',
        requester_source,
        'Atomic cancellation via rpc_cancel_incident_atomic. Source: ' || requester_source
    )
    ON CONFLICT (incident_id, action) DO NOTHING;

    RAISE NOTICE '[CANCEL_FLOW] Incident #% successfully cancelled. Ambulance #% released.', target_incident_id, v_ambulance_id;
    RETURN TRUE;
END;
$$;

-- Grant execution to the anon role (Supabase public API)
GRANT EXECUTE ON FUNCTION public.rpc_cancel_incident_atomic(BIGINT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_incident_atomic(BIGINT, TEXT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Index to speed up "find active incident by device_id" query
-- Used every time a cancel signal arrives.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_incidents_device_active
    ON public.incidents (device_id, status)
    WHERE status NOT IN ('cancelled', 'completed');


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (run after migration)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'incident_logs';
-- SELECT proname, prosrc FROM pg_proc WHERE proname = 'rpc_cancel_incident_atomic';
-- SELECT rpc_cancel_incident_atomic(1, 'test'); -- should return TRUE or FALSE cleanly
