-- READING COPY ONLY: do not execute or use as a migration.
-- Executable source: packages/db/migrations/0007_protect_ctf_reference_identity.sql
-- Original statement order, object names, quoted values and Drizzle boundaries are preserved.
-- Function versions are historical: apply the migration chain to determine the current definition.

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Rejects changes to collateral identity once a registered CTF condition depends on that asset.
CREATE FUNCTION protect_ctf_chain_asset_identity()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS(
        SELECT
            1
        FROM
            ctf_conditions condition
        WHERE
            condition.collateral_asset_id = OLD.id) AND(NEW.chain_id IS DISTINCT FROM OLD.chain_id OR NEW.contract_address IS DISTINCT FROM OLD.contract_address OR NEW.decimals IS DISTINCT FROM OLD.decimals OR NEW.asset_type IS DISTINCT FROM OLD.asset_type) THEN
        RAISE EXCEPTION 'chain asset identity referenced by a CTF condition is immutable';
    END IF;
    RETURN NEW;
END;
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Rejects changes to collateral identity once a registered CTF condition depends on that asset.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER chain_assets_protect_ctf_identity
    BEFORE UPDATE ON chain_assets
    FOR EACH ROW
    EXECUTE FUNCTION protect_ctf_chain_asset_identity();

--> statement-breakpoint

-- ============================================================================
-- FUNCTIONS AND STORED PROCEDURES (original execution order preserved)
-- ============================================================================
-- Rejects changes to deployment identity used by a CTF condition while retaining the separately managed operational fields.
CREATE FUNCTION protect_ctf_contract_deployment_identity()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS(
        SELECT
            1
        FROM
            ctf_conditions condition
        WHERE
            condition.ctf_contract_deployment_id = OLD.id
            OR condition.oracle_contract_deployment_id = OLD.id) AND(NEW.chain_id IS DISTINCT FROM OLD.chain_id OR NEW.contract_address IS DISTINCT FROM OLD.contract_address OR NEW.contract_role IS DISTINCT FROM OLD.contract_role OR NEW.contract_version IS DISTINCT FROM OLD.contract_version) THEN
        RAISE EXCEPTION 'contract deployment identity referenced by a CTF condition is immutable';
    END IF;
    RETURN NEW;
END;
$$;

--> statement-breakpoint

-- ============================================================================
-- TRIGGERS (original execution order preserved)
-- ============================================================================
-- Rejects changes to deployment identity used by a CTF condition while retaining the separately managed operational fields.
-- Runs the original protection or bookkeeping function at its declared timing and event.
CREATE TRIGGER contract_deployments_protect_ctf_identity
    BEFORE UPDATE ON contract_deployments
    FOR EACH ROW
    EXECUTE FUNCTION protect_ctf_contract_deployment_identity();
