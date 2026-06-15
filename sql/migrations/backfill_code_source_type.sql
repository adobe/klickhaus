-- Backfill code_source_type for site_configs and profile_configs.
-- Sets 'github' for github.com/www.github.com URLs, 'byogit' for all other non-empty URLs.
-- Rows with no code_source_url are left unchanged.

ALTER TABLE helix_logs_production.site_configs
UPDATE code_source_type = multiIf(
    domain(code_source_url) IN ('github.com', 'www.github.com'), 'github',
    'byogit'
)
WHERE code_source_url != '';

ALTER TABLE helix_logs_production.profile_configs
UPDATE code_source_type = multiIf(
    domain(code_source_url) IN ('github.com', 'www.github.com'), 'github',
    'byogit'
)
WHERE code_source_url != '';
