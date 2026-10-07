-- ============================================================
-- 074_shade_cards_search_trgm.sql
-- The Shade Cards search box matches "contains" (ILIKE '%text%') on five
-- columns at once (SHADE_CARD_SEARCH_COLUMNS in lib/constants/shadeCards.ts).
-- A normal btree index can't serve a leading '%', so every search read all
-- ~3,000 cards and threw nearly all of them away — the most-read table in
-- the database (pg_stat_user_tables, 2026-10-07).
--
-- A trigram (pg_trgm) GIN index splits each value into 3-letter pieces and
-- can find "contains" matches directly. Postgres combines the five with a
-- BitmapOr, one per column the OR touches. Same approach jobs already uses
-- (004_jobs_core.sql). pg_trgm is enabled in 001.
--
-- Searches of 1–2 characters still scan (a trigram needs 3 letters) — fine,
-- the table is small and short searches are rare.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_shade_cards_party_trgm             ON shade_cards USING GIN (party gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shade_cards_pm_code_trgm           ON shade_cards USING GIN (pm_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shade_cards_product_name_trgm      ON shade_cards USING GIN (product_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shade_cards_shade_card_number_trgm ON shade_cards USING GIN (shade_card_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_shade_cards_docket_number_trgm     ON shade_cards USING GIN (docket_number gin_trgm_ops);
