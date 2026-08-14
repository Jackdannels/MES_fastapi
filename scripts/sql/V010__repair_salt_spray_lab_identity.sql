-- Repair the canonical salt-spray laboratory identity without replacing its
-- existing primary key. Legacy databases may already contain LAB_SALT under
-- an English display name and linked to the retired TT_SALT test type.

USE `mes_single_branch`;

UPDATE md_lab AS lab
JOIN md_test_type AS test_type
  ON test_type.test_type_code = 'YW'
SET lab.lab_name = '盐雾试验室',
    lab.lab_type = '实验室',
    lab.test_type_id = test_type.test_type_id,
    lab.capacity = COALESCE(lab.capacity, 4),
    lab.status = 1,
    lab.remark = 'FRONTEND_MASTER_DATA'
WHERE lab.lab_code = 'LAB_SALT';

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT
  'LAB_SALT', '盐雾试验室', '实验室', test_type.test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type AS test_type
WHERE test_type.test_type_code = 'YW'
  AND NOT EXISTS (
    SELECT 1
    FROM md_lab
    WHERE lab_code = 'LAB_SALT'
  );

UPDATE biz_schedule AS schedule_row
JOIN md_lab AS lab
  ON lab.lab_code = 'LAB_SALT'
SET schedule_row.lab_id = lab.lab_id
WHERE schedule_row.device_name IN ('盐雾试验室', 'Salt Spray Lab')
  AND (schedule_row.lab_id IS NULL OR schedule_row.lab_id <> lab.lab_id);
