import { buildExperimentTypeSummary } from "@/lib/experimentTypes";
import {
  DEFAULT_AXIS_CODES,
  isAxisAwareExperimentType,
  normalizeAxisCodes,
  normalizeAxisCodesByTestType,
  normalizeText,
} from "./model";

function useTaskExperimentPickers({
  editAxisDraftByTestType,
  editAxisModal,
  editAxisPickerCodes,
  editAxisPickerType,
  editExperimentDraft,
  editExperimentModal,
  editForm,
  editWarning,
  intakeAxisDraftByTestType,
  intakeAxisModal,
  intakeAxisPickerCodes,
  intakeAxisPickerType,
  intakeExperimentDraft,
  intakeExperimentModal,
  intakeForm,
  intakeWarning,
  isTaskDetailLocked,
  syncIntakeDerivedFields,
}) {
  const toggleExperimentDraftType = (draftRef, experimentType) => {
    const normalizedType = normalizeText(experimentType);
    if (!normalizedType) {
      return;
    }
    const currentTypes = Array.isArray(draftRef.value) ? [...draftRef.value] : [];
    const targetIndex = currentTypes.findIndex((entry) => normalizeText(entry) === normalizedType);
    if (targetIndex >= 0) {
      currentTypes.splice(targetIndex, 1);
    } else {
      currentTypes.push(normalizedType);
    }
    draftRef.value = currentTypes;
  };

  const openIntakeExperimentPicker = () => {
    intakeExperimentDraft.value = Array.isArray(intakeForm.value.test_types) ? [...intakeForm.value.test_types] : [];
    intakeAxisDraftByTestType.value = normalizeAxisCodesByTestType(
      intakeForm.value.axis_codes_by_test_type || intakeForm.value.axisCodesByTestType,
      intakeExperimentDraft.value,
    );
    intakeExperimentModal.openWith({ id: "task-intake-test-types-modal" });
  };

  const closeIntakeExperimentPicker = () => {
    intakeExperimentModal.close();
    intakeExperimentDraft.value = [];
    intakeAxisDraftByTestType.value = {};
  };

  const openIntakeAxisPicker = (experimentType) => {
    const normalizedType = normalizeText(experimentType);
    if (!isAxisAwareExperimentType(normalizedType)) {
      return;
    }
    const existingCodes = normalizeAxisCodes(intakeAxisDraftByTestType.value?.[normalizedType]);
    intakeAxisPickerType.value = normalizedType;
    intakeAxisPickerCodes.value = existingCodes.length > 0 ? existingCodes : [...DEFAULT_AXIS_CODES];
    intakeAxisModal.openWith({ id: "task-intake-axis-modal", experimentType: normalizedType });
  };

  const closeIntakeAxisPicker = () => {
    intakeAxisModal.close();
    intakeAxisPickerType.value = "";
    intakeAxisPickerCodes.value = [];
  };

  const toggleIntakeAxisCode = (axisCode) => {
    const normalizedCode = normalizeAxisCodes([axisCode])[0];
    if (!normalizedCode) {
      return;
    }
    const currentCodes = normalizeAxisCodes(intakeAxisPickerCodes.value);
    intakeAxisPickerCodes.value = currentCodes.includes(normalizedCode)
      ? currentCodes.filter((code) => code !== normalizedCode)
      : [...currentCodes, normalizedCode];
  };

  const confirmIntakeAxisPicker = () => {
    const experimentType = normalizeText(intakeAxisPickerType.value);
    const axisCodes = normalizeAxisCodes(intakeAxisPickerCodes.value);
    if (!experimentType || axisCodes.length === 0) {
      intakeWarning.value = "请选择至少一个试验轴向";
      return;
    }
    if (!intakeExperimentDraft.value.includes(experimentType)) {
      intakeExperimentDraft.value = [...intakeExperimentDraft.value, experimentType];
    }
    intakeAxisDraftByTestType.value = {
      ...intakeAxisDraftByTestType.value,
      [experimentType]: axisCodes,
    };
    intakeWarning.value = "";
    closeIntakeAxisPicker();
  };

  const toggleIntakeExperimentType = (experimentType) => {
    const normalizedType = normalizeText(experimentType);
    if (isAxisAwareExperimentType(normalizedType) && !intakeExperimentDraft.value.includes(normalizedType)) {
      openIntakeAxisPicker(normalizedType);
      return;
    }
    toggleExperimentDraftType(intakeExperimentDraft, experimentType);
    if (isAxisAwareExperimentType(normalizedType)) {
      const nextAxisDraft = { ...intakeAxisDraftByTestType.value };
      delete nextAxisDraft[normalizedType];
      intakeAxisDraftByTestType.value = nextAxisDraft;
    }
  };

  const confirmIntakeExperimentPicker = () => {
    intakeForm.value.test_types = Array.isArray(intakeExperimentDraft.value) ? [...intakeExperimentDraft.value] : [];
    intakeForm.value.axis_codes_by_test_type = normalizeAxisCodesByTestType(
      intakeAxisDraftByTestType.value,
      intakeForm.value.test_types,
    );
    intakeWarning.value = "";
    syncIntakeDerivedFields();
    closeIntakeExperimentPicker();
  };

  const openEditExperimentPicker = () => {
    if (isTaskDetailLocked.value) {
      return;
    }
    editExperimentDraft.value = Array.isArray(editForm.value.test_types) ? [...editForm.value.test_types] : [];
    editAxisDraftByTestType.value = normalizeAxisCodesByTestType(
      editForm.value.axis_codes_by_test_type || editForm.value.axisCodesByTestType,
      editExperimentDraft.value,
    );
    editExperimentModal.openWith({ id: "task-edit-test-types-modal" });
  };

  const closeEditExperimentPicker = () => {
    editExperimentModal.close();
    editAxisModal.close();
    editExperimentDraft.value = [];
    editAxisDraftByTestType.value = {};
    editAxisPickerType.value = "";
    editAxisPickerCodes.value = [];
  };

  const openEditAxisPicker = (experimentType) => {
    const normalizedType = normalizeText(experimentType);
    if (!isAxisAwareExperimentType(normalizedType)) {
      return;
    }
    const existingCodes = normalizeAxisCodes(editAxisDraftByTestType.value?.[normalizedType]);
    editAxisPickerType.value = normalizedType;
    editAxisPickerCodes.value = existingCodes.length > 0 ? existingCodes : [...DEFAULT_AXIS_CODES];
    editAxisModal.openWith({ id: "task-edit-axis-modal", experimentType: normalizedType });
  };

  const closeEditAxisPicker = () => {
    editAxisModal.close();
    editAxisPickerType.value = "";
    editAxisPickerCodes.value = [];
  };

  const toggleEditAxisCode = (axisCode) => {
    const normalizedCode = normalizeAxisCodes([axisCode])[0];
    if (!normalizedCode) {
      return;
    }
    const currentCodes = normalizeAxisCodes(editAxisPickerCodes.value);
    editAxisPickerCodes.value = currentCodes.includes(normalizedCode)
      ? currentCodes.filter((code) => code !== normalizedCode)
      : [...currentCodes, normalizedCode];
  };

  const confirmEditAxisPicker = () => {
    const experimentType = normalizeText(editAxisPickerType.value);
    const axisCodes = normalizeAxisCodes(editAxisPickerCodes.value);
    if (!experimentType || axisCodes.length === 0) {
      editWarning.value = "请选择至少一个试验轴向";
      return;
    }
    if (!editExperimentDraft.value.includes(experimentType)) {
      editExperimentDraft.value = [...editExperimentDraft.value, experimentType];
    }
    editAxisDraftByTestType.value = {
      ...editAxisDraftByTestType.value,
      [experimentType]: axisCodes,
    };
    editWarning.value = "";
    closeEditAxisPicker();
  };

  const removeEditAxisExperiment = () => {
    const experimentType = normalizeText(editAxisPickerType.value);
    if (!experimentType) {
      closeEditAxisPicker();
      return;
    }
    editExperimentDraft.value = editExperimentDraft.value.filter((entry) => normalizeText(entry) !== experimentType);
    const nextAxisDraft = { ...editAxisDraftByTestType.value };
    delete nextAxisDraft[experimentType];
    editAxisDraftByTestType.value = nextAxisDraft;
    closeEditAxisPicker();
  };

  const toggleEditExperimentType = (experimentType) => {
    const normalizedType = normalizeText(experimentType);
    if (isAxisAwareExperimentType(normalizedType)) {
      openEditAxisPicker(normalizedType);
      return;
    }
    toggleExperimentDraftType(editExperimentDraft, experimentType);
  };

  const confirmEditExperimentPicker = () => {
    editForm.value.test_types = Array.isArray(editExperimentDraft.value) ? [...editExperimentDraft.value] : [];
    editForm.value.test_type = buildExperimentTypeSummary(editForm.value.test_types);
    editForm.value.axis_codes_by_test_type = normalizeAxisCodesByTestType(
      editAxisDraftByTestType.value,
      editForm.value.test_types,
    );
    editWarning.value = "";
    closeEditExperimentPicker();
  };

  return {
    closeEditAxisPicker,
    closeEditExperimentPicker,
    closeIntakeAxisPicker,
    closeIntakeExperimentPicker,
    confirmEditAxisPicker,
    confirmEditExperimentPicker,
    confirmIntakeAxisPicker,
    confirmIntakeExperimentPicker,
    openEditAxisPicker,
    openEditExperimentPicker,
    openIntakeAxisPicker,
    openIntakeExperimentPicker,
    removeEditAxisExperiment,
    toggleEditAxisCode,
    toggleEditExperimentType,
    toggleIntakeAxisCode,
    toggleIntakeExperimentType,
  };
}

export { useTaskExperimentPickers };
