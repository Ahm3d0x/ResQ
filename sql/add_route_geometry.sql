-- ============================================================================
-- EnQaZ — Add missing route_geometry column to incidents table
-- Run ONCE in Supabase SQL Editor.
--
-- Why: enginesimulator.js writes the OSRM-computed route as GeoJSON into
-- incidents.route_geometry after each successful route fetch. driver.js reads
-- this column to render the route polyline on the driver's map. The column
-- was referenced in code but never added to the schema, causing a 400 Bad
-- Request on every PATCH after a route is compiled.
-- ============================================================================

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS route_geometry TEXT NULL;

-- Optional: add a comment for documentation
COMMENT ON COLUMN public.incidents.route_geometry IS
    'GeoJSON LineString (stringified) of the OSRM-computed ambulance route. '
    'Written by enginesimulator.js after each route fetch. '
    'Read by driver.js to render the route polyline on the driver map.';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable
-- FROM   information_schema.columns
-- WHERE  table_name = 'incidents'
--   AND  column_name = 'route_geometry';
-- Expected: 1 row, data_type = 'text', is_nullable = 'YES'
