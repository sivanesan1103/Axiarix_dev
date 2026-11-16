-- Integrity controls enforced at the database layer, in addition to the service layer.

-- 1. Audit events are append-only (NFR-SEC-06). Any UPDATE or DELETE is rejected.
CREATE OR REPLACE FUNCTION axiarix_block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION axiarix_block_audit_mutation();
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION axiarix_block_audit_mutation();

-- 2. Items and mappings of a PUBLISHED or ARCHIVED checklist version are immutable (FR-007).
CREATE OR REPLACE FUNCTION axiarix_block_published_item_mutation() RETURNS trigger AS $$
DECLARE
  v_status text;
  v_version_id text;
BEGIN
  IF TG_TABLE_NAME = 'ChecklistItem' THEN
    v_version_id := COALESCE(OLD."versionId", NEW."versionId");
  ELSE
    SELECT "versionId" INTO v_version_id FROM "ChecklistItem"
      WHERE id = COALESCE(OLD."itemId", NEW."itemId");
  END IF;
  SELECT status::text INTO v_status FROM "ChecklistVersion" WHERE id = v_version_id;
  IF v_status IN ('PUBLISHED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Checklist version % is % and cannot be modified', v_version_id, v_status;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER checklist_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON "ChecklistItem"
  FOR EACH ROW EXECUTE FUNCTION axiarix_block_published_item_mutation();
CREATE TRIGGER control_mapping_immutable BEFORE INSERT OR UPDATE OR DELETE ON "ControlMapping"
  FOR EACH ROW EXECUTE FUNCTION axiarix_block_published_item_mutation();

-- 3. Generated reports are immutable; only archival metadata may change.
CREATE OR REPLACE FUNCTION axiarix_block_report_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reports cannot be deleted directly; use the secure deletion workflow';
  END IF;
  IF NEW."storageKey" <> OLD."storageKey" OR NEW.checksum <> OLD.checksum
     OR NEW.summary::text <> OLD.summary::text OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Report content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER report_immutable BEFORE UPDATE OR DELETE ON "Report"
  FOR EACH ROW EXECUTE FUNCTION axiarix_block_report_mutation();
