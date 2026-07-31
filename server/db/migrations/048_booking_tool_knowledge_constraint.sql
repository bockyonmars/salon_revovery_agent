ALTER TABLE tool_calls
  DROP CONSTRAINT IF EXISTS tool_calls_tool_name_check;

ALTER TABLE tool_calls
  ADD CONSTRAINT tool_calls_tool_name_check
  CHECK (tool_name IN (
    'get_salon_information',
    'list_services',
    'get_service_details',
    'list_staff',
    'search_support_knowledge',
    'search_availability',
    'create_temporary_hold'
  ));
