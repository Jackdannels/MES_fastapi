const createLaboratoryWorkflow = () => ({
  comparisonDone: false,
  experimentConfirmed: false,
  fixtureReadyDone: false,
  hasCompared: false,
  hasInstalled: false,
  installationDone: false,
});

const getLaboratoryActionState = (workflow = createLaboratoryWorkflow()) => {
  if (workflow.experimentConfirmed) {
    return {
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    };
  }
  const hasComparedWaitingInstall = Object.prototype.hasOwnProperty.call(workflow, "hasComparedWaitingInstall")
    ? workflow.hasComparedWaitingInstall
    : !workflow.hasInstalled && (workflow.hasCompared || workflow.comparisonDone) && !workflow.installationDone;
  const hasInstalledWaitingReady = Object.prototype.hasOwnProperty.call(workflow, "hasInstalledWaitingReady")
    ? workflow.hasInstalledWaitingReady
    : (workflow.hasInstalled || workflow.installationDone) && !workflow.experimentConfirmed;
  const hasInProgressPreparation = Object.prototype.hasOwnProperty.call(workflow, "hasInProgressPreparation")
    ? workflow.hasInProgressPreparation
    : Boolean(workflow.hasInstalled);
  const fixtureReadyDone = Object.prototype.hasOwnProperty.call(workflow, "fixtureReadyDone")
    ? workflow.fixtureReadyDone
    : false;
  const hasCurrentLaboratoryDispatch = Object.prototype.hasOwnProperty.call(workflow, "hasCurrentLaboratoryDispatch")
    ? workflow.hasCurrentLaboratoryDispatch
    : true;
  const hasActiveOtherExperimentRun = Object.prototype.hasOwnProperty.call(workflow, "hasActiveOtherExperimentRun")
    ? workflow.hasActiveOtherExperimentRun
    : false;
  const hasComparableTrayWithoutActiveOtherExperiment = Object.prototype.hasOwnProperty.call(
    workflow,
    "hasComparableTrayWithoutActiveOtherExperiment",
  )
    ? workflow.hasComparableTrayWithoutActiveOtherExperiment
    : false;
  if (hasActiveOtherExperimentRun && !hasComparableTrayWithoutActiveOtherExperiment) {
    return {
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    };
  }
  const canContinueComparingAvailableTrays =
    hasActiveOtherExperimentRun && hasComparableTrayWithoutActiveOtherExperiment;
  return {
    canCompare:
      hasCurrentLaboratoryDispatch
      && !workflow.comparisonDone
      && (!hasInProgressPreparation || canContinueComparingAvailableTrays),
    canInstallSample: Boolean(hasComparedWaitingInstall),
    canMarkReady: Boolean(hasInstalledWaitingReady && fixtureReadyDone),
  };
};

const completeLaboratoryComparison = (workflow = createLaboratoryWorkflow()) => ({
  ...workflow,
  comparisonDone: true,
  experimentConfirmed: false,
  hasCompared: true,
  hasInstalled: false,
  installationDone: false,
});

const completeLaboratoryInstallation = (workflow = createLaboratoryWorkflow()) => {
  if (!(workflow.hasCompared || workflow.comparisonDone)) {
    return { ...workflow };
  }
  return {
    ...workflow,
    hasCompared: true,
    hasInstalled: true,
    installationDone: true,
    fixtureReadyDone: false,
    experimentConfirmed: false,
  };
};

const confirmLaboratoryExperiment = (workflow = createLaboratoryWorkflow()) => {
  if (!(workflow.hasInstalled || workflow.installationDone) || !workflow.fixtureReadyDone) {
    return { ...workflow };
  }
  return {
    comparisonDone: true,
    experimentConfirmed: true,
    fixtureReadyDone: true,
    hasCompared: true,
    hasInstalled: true,
    installationDone: true,
  };
};

export {
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
};
