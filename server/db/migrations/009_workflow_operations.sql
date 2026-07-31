-- Workflow causation can originate from an immutable provider event or an audited manual action.
ALTER TABLE workflow_jobs ALTER COLUMN causation_event_id TYPE text USING causation_event_id::text;
ALTER TABLE workflow_jobs DROP CONSTRAINT IF EXISTS workflow_jobs_causation_event_id_workflow_type_key;
