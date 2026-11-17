CREATE FUNCTION protect_ctf_chain_asset_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM ctf_conditions condition
		WHERE condition.collateral_asset_id = OLD.id
	) AND (
		NEW.chain_id IS DISTINCT FROM OLD.chain_id
		OR NEW.contract_address IS DISTINCT FROM OLD.contract_address
		OR NEW.decimals IS DISTINCT FROM OLD.decimals
		OR NEW.asset_type IS DISTINCT FROM OLD.asset_type
	) THEN
		RAISE EXCEPTION 'chain asset identity referenced by a CTF condition is immutable';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER chain_assets_protect_ctf_identity
	BEFORE UPDATE ON chain_assets
	FOR EACH ROW
	EXECUTE FUNCTION protect_ctf_chain_asset_identity();--> statement-breakpoint
CREATE FUNCTION protect_ctf_contract_deployment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM ctf_conditions condition
		WHERE condition.ctf_contract_deployment_id = OLD.id
			OR condition.oracle_contract_deployment_id = OLD.id
	) AND (
		NEW.chain_id IS DISTINCT FROM OLD.chain_id
		OR NEW.contract_address IS DISTINCT FROM OLD.contract_address
		OR NEW.contract_role IS DISTINCT FROM OLD.contract_role
		OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
	) THEN
		RAISE EXCEPTION 'contract deployment identity referenced by a CTF condition is immutable';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER contract_deployments_protect_ctf_identity
	BEFORE UPDATE ON contract_deployments
	FOR EACH ROW
	EXECUTE FUNCTION protect_ctf_contract_deployment_identity();
