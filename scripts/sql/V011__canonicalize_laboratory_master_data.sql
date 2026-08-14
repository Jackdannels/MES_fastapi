-- Keep one canonical laboratory and test-type master-data set. The original
-- English demo rows and demo equipment are obsolete and are removed.

USE `mes_single_branch`;

INSERT INTO md_test_type (
  test_type_code, test_type_name, test_category, default_duration_hour, status, remark
)
SELECT 'CJ', '冲击试验', '力学试验', NULL, 1, 'FRONTEND_MASTER_DATA'
UNION ALL SELECT 'ZD', '振动试验', '力学试验', NULL, 1, 'FRONTEND_MASTER_DATA'
UNION ALL SELECT 'SZH', '四综合试验', '综合试验', NULL, 1, 'FRONTEND_MASTER_DATA'
UNION ALL SELECT 'WDC', '温度冲击试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
UNION ALL SELECT 'GDW', '高低温湿热试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
UNION ALL SELECT 'YW', '盐雾试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
UNION ALL SELECT 'MJ', '霉菌试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
ON DUPLICATE KEY UPDATE
  test_type_name = VALUES(test_type_name),
  test_category = VALUES(test_category),
  default_duration_hour = VALUES(default_duration_hour),
  status = VALUES(status),
  remark = VALUES(remark);

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT seed.lab_code, seed.lab_name, seed.lab_type, test_type.test_type_id,
       seed.capacity, '', 1, 'FRONTEND_MASTER_DATA'
FROM (
  SELECT 'LAB_IMPACT_1' AS lab_code, '冲击一室' AS lab_name, '实验室' AS lab_type, 'CJ' AS test_type_code, 4 AS capacity
  UNION ALL SELECT 'LAB_IMPACT_2', '冲击二室', '实验室', 'CJ', 4
  UNION ALL SELECT 'LAB_VIBRATION_1', '振动一室', '实验室', 'ZD', 4
  UNION ALL SELECT 'LAB_VIBRATION_2', '振动二室', '实验室', 'ZD', 4
  UNION ALL SELECT 'LAB_COMPREHENSIVE', '四综合实验室', '实验室', 'SZH', 4
  UNION ALL SELECT 'LAB_TEMP_SHOCK_1', '温度冲击一室', '实验室', 'WDC', 4
  UNION ALL SELECT 'LAB_TEMP_SHOCK_2', '温度冲击二室', '实验室', 'WDC', 4
  UNION ALL SELECT 'LAB_HOT_HUMID', '高低温湿热一室', '实验室', 'GDW', 4
  UNION ALL SELECT 'LAB_HOT_HUMID_2', '高低温湿热二室', '实验室', 'GDW', 4
  UNION ALL SELECT 'LAB_SALT', '盐雾试验室', '实验室', 'YW', 4
  UNION ALL SELECT 'LAB_MOLD', '霉菌试验室', '实验室', 'MJ', 4
  UNION ALL SELECT 'AREA_STAGING_PRE', '恒温恒湿间（暂存间）', '暂存间', NULL, 0
  UNION ALL SELECT 'AREA_STAGING_POST', '恒温恒湿间（实验后暂存间）', '暂存间', NULL, 0
  UNION ALL SELECT 'AREA_APPEARANCE', '外观检测间', '检测间', NULL, 0
  UNION ALL SELECT 'AREA_UNBOX', '拆箱操作间', '操作区', NULL, 0
  UNION ALL SELECT 'AREA_OUTDOOR_HANDOVER', '室外接驳区', '接驳区', NULL, 0
) AS seed
LEFT JOIN md_test_type AS test_type
  ON test_type.test_type_code = seed.test_type_code
ON DUPLICATE KEY UPDATE
  lab_name = VALUES(lab_name),
  lab_type = VALUES(lab_type),
  test_type_id = VALUES(test_type_id),
  capacity = VALUES(capacity),
  location_desc = VALUES(location_desc),
  status = VALUES(status),
  remark = VALUES(remark);

-- Move any remaining references off obsolete generic rooms before deleting them.
UPDATE biz_schedule AS row_to_fix
JOIN md_lab AS old_lab ON old_lab.lab_id = row_to_fix.lab_id
JOIN md_lab AS canonical_lab
  ON canonical_lab.lab_code = CASE old_lab.lab_code
    WHEN 'LAB_IMPACT' THEN 'LAB_IMPACT_1'
    WHEN 'LAB_VIB' THEN 'LAB_VIBRATION_1'
  END
SET row_to_fix.lab_id = canonical_lab.lab_id
WHERE old_lab.lab_code IN ('LAB_IMPACT', 'LAB_VIB');

UPDATE biz_tray AS row_to_fix
JOIN md_lab AS old_lab ON old_lab.lab_id = row_to_fix.current_lab_id
JOIN md_lab AS canonical_lab
  ON canonical_lab.lab_code = CASE old_lab.lab_code
    WHEN 'LAB_IMPACT' THEN 'LAB_IMPACT_1'
    WHEN 'LAB_VIB' THEN 'LAB_VIBRATION_1'
  END
SET row_to_fix.current_lab_id = canonical_lab.lab_id
WHERE old_lab.lab_code IN ('LAB_IMPACT', 'LAB_VIB');

UPDATE exec_test_run AS row_to_fix
JOIN md_lab AS old_lab ON old_lab.lab_id = row_to_fix.lab_id
JOIN md_lab AS canonical_lab
  ON canonical_lab.lab_code = CASE old_lab.lab_code
    WHEN 'LAB_IMPACT' THEN 'LAB_IMPACT_1'
    WHEN 'LAB_VIB' THEN 'LAB_VIBRATION_1'
  END
SET row_to_fix.lab_id = canonical_lab.lab_id
WHERE old_lab.lab_code IN ('LAB_IMPACT', 'LAB_VIB');

-- Remove the three obsolete demo devices and their collection metadata.
UPDATE biz_data_stream SET equipment_id = NULL
WHERE equipment_id IN (SELECT equipment_id FROM md_equipment WHERE equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001'));
UPDATE biz_schedule SET equipment_id = NULL
WHERE equipment_id IN (SELECT equipment_id FROM md_equipment WHERE equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001'));
UPDATE biz_tray SET current_equipment_id = NULL
WHERE current_equipment_id IN (SELECT equipment_id FROM md_equipment WHERE equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001'));
UPDATE biz_tray_trace SET equipment_id = NULL
WHERE equipment_id IN (SELECT equipment_id FROM md_equipment WHERE equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001'));
UPDATE ctrl_device_command_log SET equipment_id = NULL
WHERE equipment_id IN (SELECT equipment_id FROM md_equipment WHERE equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001'));
UPDATE exec_test_run SET equipment_id = NULL
WHERE equipment_id IN (SELECT equipment_id FROM md_equipment WHERE equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001'));
DELETE connection_row
FROM md_equipment_connection AS connection_row
JOIN md_equipment AS equipment ON equipment.equipment_id = connection_row.equipment_id
WHERE equipment.equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001');
DELETE point_row
FROM md_equipment_point AS point_row
JOIN md_equipment AS equipment ON equipment.equipment_id = point_row.equipment_id
WHERE equipment.equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001');
DELETE FROM md_equipment
WHERE equipment_code IN ('EQ-IM-001', 'EQ-VB-001', 'EQ-SS-001');

DELETE FROM md_lab
WHERE lab_code IN ('LAB_IMPACT', 'LAB_VIB');

DELETE FROM md_test_type
WHERE test_type_code IN ('TT_IMPACT', 'TT_VIB', 'TT_SALT', 'TT_TEMP', 'TT_MOLD');

-- Link the active application device rows to the canonical laboratory and type.
UPDATE md_equipment AS equipment
JOIN md_lab AS lab ON lab.lab_name = equipment.equipment_code
SET equipment.lab_id = lab.lab_id,
    equipment.test_type_id = lab.test_type_id
WHERE lab.lab_code LIKE 'LAB\_%';
