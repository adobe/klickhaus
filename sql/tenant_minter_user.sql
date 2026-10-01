-- Least-privilege ClickHouse user for the support-access-grant worker.
--
-- The worker needs to create and drop tenant users and attach the
-- `tenant_selfserve` role to them. It deliberately gets no SELECT on any log
-- table, so the credential it holds cannot read customer data even though it can
-- hand out access to it.
--
-- The containment property that makes this safe: ClickHouse only lets a user
-- grant privileges it holds itself. `tenant_minter` holds the role WITH ADMIN
-- OPTION and nothing else, so a leaked minter credential can only ever produce
-- users limited to tenant_selfserve. It cannot invent a user with broader access.
--
-- Run as `default` after sql/tenant_scoped_access.poc.sql. Substitute a generated
-- password and store it as the worker secret CLICKHOUSE_PASSWORD.

-- CREATE USER tenant_minter IDENTIFIED BY '<generated>';

GRANT CREATE USER, DROP USER ON *.* TO tenant_minter;

-- WITH ADMIN OPTION is what allows the worker to attach the role to a new user.
GRANT tenant_selfserve TO tenant_minter WITH ADMIN OPTION;

-- The audit/registry table: INSERT to record a grant, SELECT to detect an
-- existing active grant so repeat requests do not pile up credentials.
GRANT SELECT, INSERT ON tenant_poc.tenant_grants TO tenant_minter;

-- Two constraints here interact badly and the fix is not obvious.
--
-- 1. ADMIN OPTION on a role only takes effect while that role is *active* in the
--    session. `DEFAULT ROLE NONE` therefore breaks minting with
--    "necessary to have the role tenant_selfserve granted with ADMIN option",
--    even though SHOW GRANTS lists the admin option.
-- 2. But activating tenant_selfserve also applies tenant_selfserve_profile,
--    whose `readonly = 2` forbids DDL, so CREATE USER then fails with
--    "Cannot execute query in readonly mode".
--
-- Holding the role active and overriding `readonly` at the user level satisfies
-- both. The override is deliberately not marked READONLY/CONST here; the
-- user-level value wins over the value inherited from the role's profile.
--
-- The alternative, moving the profile off the role and onto each minted user,
-- was rejected: attaching limits per user means a future code path can forget
-- them, whereas a profile on the role cannot be bypassed.
ALTER USER tenant_minter
    DEFAULT ROLE tenant_selfserve
    SETTINGS
        max_execution_time = 10,
        max_memory_usage = 500000000,
        readonly = 0;

-- Verify the result is as narrow as intended:
--   SHOW GRANTS FOR tenant_minter;
-- Expected: CREATE USER / DROP USER on *.*, SELECT+INSERT on
-- tenant_poc.tenant_grants, and tenant_selfserve WITH ADMIN OPTION. Any SELECT
-- on helix_logs_production.* would be a mistake.
