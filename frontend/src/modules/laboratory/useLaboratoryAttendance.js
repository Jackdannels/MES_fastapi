import { computed, nextTick, onBeforeUnmount, ref } from "vue";

import { useScanInputFocus } from "@/composables/useScanInputFocus";
import {
  loginLaboratoryAttendance,
  loginLaboratoryAttendanceByQr,
  logoutLaboratoryAttendance,
  markLaboratoryAttendanceWorkStarted,
  readLaboratoryAttendanceSession,
} from "@/lib/attendanceApi";
import { parseBusinessDateTimeToMs } from "@/lib/dateTime";
import {
  formatAttendanceDuration,
  formatErrorMessage,
  formatFlowTimeForAttendance,
  normalizeText,
} from "./pageHelpers";

const ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS = 30;

function useLaboratoryAttendance({ laboratoryConfig, tickNow }) {
  const attendanceSession = ref({ active: false });
  const attendanceLoginModalOpen = ref(false);
  const attendanceLoginMode = ref("qr");
  const attendanceLoginUsername = ref("");
  const attendanceLoginPassword = ref("");
  const attendanceQrInputRef = ref(null);
  const attendanceQrPayload = ref("");
  const attendanceLoginError = ref("");
  const attendanceSubmitting = ref(false);
  const attendanceLogoutPromptOpen = ref(false);
  const attendanceLogoutCountdown = ref(ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS);
  const { focusScanInput: focusAttendanceQrInput } = useScanInputFocus(attendanceQrInputRef);

  let attendanceLogoutTimer = null;
  let attendanceSessionLoadPromise = null;
  let attendanceWorkStartPendingKey = "";
  let optimisticAttendanceWorkStartedAt = "";
  let suppressNextAttendanceWorkStart = false;
  let pendingAttendanceAction = null;

  const attendanceLoggedIn = computed(() => Boolean(
    attendanceSession.value?.active && normalizeText(attendanceSession.value?.username),
  ));
  const attendanceWorkStartedAt = computed(() => normalizeText(
    attendanceSession.value?.workStartedAt || attendanceSession.value?.work_started_at,
  ));
  const attendanceStatus = computed(() => {
    if (!attendanceLoggedIn.value) {
      return {
        detail: "请先登录后操作",
        employeeName: "未登录",
      };
    }
    const loggedInAt = normalizeText(attendanceSession.value?.loggedInAt || attendanceSession.value?.logged_in_at);
    const workStartedAt = attendanceWorkStartedAt.value;
    const workStartedTime = workStartedAt ? parseBusinessDateTimeToMs(workStartedAt) : null;
    const elapsedSeconds = !Number.isFinite(workStartedTime)
      ? 0
      : Math.floor((tickNow.value.getTime() - workStartedTime) / 1000);
    return {
      detail: `${loggedInAt ? formatFlowTimeForAttendance(loggedInAt) : "--:--"} 登录 / 当前 ${formatAttendanceDuration(elapsedSeconds)}`,
      employeeName: normalizeText(
        attendanceSession.value?.employeeName
        || attendanceSession.value?.employee_name
        || attendanceSession.value?.username,
      ),
    };
  });

  const clearAttendanceLogoutTimer = () => {
    if (attendanceLogoutTimer && typeof window !== "undefined") {
      window.clearInterval(attendanceLogoutTimer);
      attendanceLogoutTimer = null;
    }
  };

  const loadAttendanceSession = async (labName = laboratoryConfig.value.labName) => {
    const normalizedLabName = normalizeText(labName);
    if (!normalizedLabName) {
      attendanceSession.value = { active: false };
      return;
    }
    const loadPromise = (async () => {
      try {
        attendanceSession.value = await readLaboratoryAttendanceSession(normalizedLabName);
      } catch {
        attendanceSession.value = { active: false, labName: normalizedLabName };
      }
    })();
    attendanceSessionLoadPromise = loadPromise;
    try {
      await loadPromise;
    } finally {
      if (attendanceSessionLoadPromise === loadPromise) {
        attendanceSessionLoadPromise = null;
      }
    }
  };

  const openAttendanceLogin = () => {
    attendanceLoginError.value = "";
    attendanceLoginPassword.value = "";
    attendanceQrPayload.value = "";
    attendanceLoginMode.value = "qr";
    attendanceLoginModalOpen.value = true;
    void nextTick().then(() => focusAttendanceQrInput());
  };

  const closeAttendanceLogin = () => {
    attendanceLoginModalOpen.value = false;
    attendanceQrPayload.value = "";
    pendingAttendanceAction = null;
  };

  const runWithAttendance = async (action) => {
    if (attendanceLoggedIn.value) {
      await action();
      return;
    }
    if (attendanceSessionLoadPromise) {
      await attendanceSessionLoadPromise;
    }
    if (attendanceLoggedIn.value) {
      await action();
      return;
    }
    pendingAttendanceAction = action;
    openAttendanceLogin();
  };

  const setAttendanceLoginMode = async (mode) => {
    attendanceLoginMode.value = mode === "qr" ? "qr" : "password";
    attendanceLoginError.value = "";
    if (attendanceLoginMode.value === "qr") {
      await nextTick();
      await focusAttendanceQrInput();
    }
  };

  const finishAttendanceLogin = async (session) => {
    attendanceSession.value = session;
    attendanceLoginModalOpen.value = false;
    attendanceLoginPassword.value = "";
    attendanceQrPayload.value = "";
    const action = pendingAttendanceAction;
    pendingAttendanceAction = null;
    if (typeof action === "function") {
      await action();
    }
  };

  const submitAttendanceLogin = async () => {
    if (attendanceSubmitting.value) {
      return;
    }
    attendanceLoginError.value = "";
    attendanceSubmitting.value = true;
    try {
      attendanceSession.value = await loginLaboratoryAttendance({
        labName: laboratoryConfig.value.labName,
        password: attendanceLoginPassword.value,
        username: attendanceLoginUsername.value,
      });
      await finishAttendanceLogin(attendanceSession.value);
    } catch (error) {
      attendanceLoginError.value = formatErrorMessage(error) || "试验间登录失败";
    } finally {
      attendanceSubmitting.value = false;
    }
  };

  const submitAttendanceQrLogin = async () => {
    if (attendanceSubmitting.value) {
      return;
    }
    attendanceLoginError.value = "";
    attendanceSubmitting.value = true;
    try {
      const session = await loginLaboratoryAttendanceByQr({
        labName: laboratoryConfig.value.labName,
        qrPayload: attendanceQrPayload.value,
      });
      await finishAttendanceLogin(session);
    } catch (error) {
      attendanceLoginError.value = formatErrorMessage(error) || "扫码登录失败";
    } finally {
      attendanceSubmitting.value = false;
    }
  };

  const startAttendanceWorkOptimistically = (startedAt = "") => {
    const normalizedStartedAt = normalizeText(startedAt);
    if (!attendanceLoggedIn.value || attendanceWorkStartedAt.value || !normalizedStartedAt) {
      return null;
    }
    const previousSession = { ...(attendanceSession.value || {}) };
    attendanceSession.value = {
      ...previousSession,
      active: true,
      labName: normalizeText(previousSession.labName || previousSession.lab_name) || laboratoryConfig.value.labName,
      workStartedAt: normalizedStartedAt,
    };
    optimisticAttendanceWorkStartedAt = normalizedStartedAt;
    suppressNextAttendanceWorkStart = true;
    return previousSession;
  };

  const rollbackOptimisticAttendanceWork = (previousSession, startedAt = "") => {
    if (!previousSession) {
      return;
    }
    const normalizedStartedAt = normalizeText(startedAt);
    if (normalizeText(attendanceSession.value?.workStartedAt || attendanceSession.value?.work_started_at) !== normalizedStartedAt) {
      return;
    }
    attendanceSession.value = previousSession;
    optimisticAttendanceWorkStartedAt = "";
    suppressNextAttendanceWorkStart = false;
  };

  const applyExperimentStartAttendance = (session) => {
    if (!session || typeof session !== "object") {
      return;
    }
    attendanceSession.value = session;
    optimisticAttendanceWorkStartedAt = normalizeText(
      session.workStartedAt || session.work_started_at,
    ) || optimisticAttendanceWorkStartedAt;
  };

  const setSuppressNextAttendanceWorkStart = (value) => {
    suppressNextAttendanceWorkStart = Boolean(value);
  };

  const resetAttendanceInteraction = () => {
    attendanceLoginModalOpen.value = false;
    attendanceQrPayload.value = "";
    attendanceLogoutPromptOpen.value = false;
    pendingAttendanceAction = null;
    clearAttendanceLogoutTimer();
  };

  const logoutAttendance = async (reason = "manual") => {
    clearAttendanceLogoutTimer();
    attendanceLogoutPromptOpen.value = false;
    attendanceLogoutCountdown.value = ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS;
    attendanceSession.value = await logoutLaboratoryAttendance({
      labName: laboratoryConfig.value.labName,
      reason,
    });
  };

  const openAttendanceLogoutPrompt = () => {
    if (!attendanceLoggedIn.value || typeof window === "undefined") {
      return;
    }
    clearAttendanceLogoutTimer();
    attendanceLogoutCountdown.value = ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS;
    attendanceLogoutPromptOpen.value = true;
    attendanceLogoutTimer = window.setInterval(() => {
      attendanceLogoutCountdown.value = Math.max(0, attendanceLogoutCountdown.value - 1);
      if (attendanceLogoutCountdown.value > 0) {
        return;
      }
      void logoutAttendance("completion-timeout").catch((error) => {
        attendanceLoginError.value = formatErrorMessage(error);
      });
    }, 1000);
  };

  const startWorkForRunningExperiment = (startKey) => {
    if (suppressNextAttendanceWorkStart) {
      suppressNextAttendanceWorkStart = false;
      return;
    }
    if (optimisticAttendanceWorkStartedAt && attendanceWorkStartedAt.value) {
      return;
    }
    optimisticAttendanceWorkStartedAt = "";
    if (!startKey || !attendanceLoggedIn.value || attendanceWorkStartedAt.value || attendanceWorkStartPendingKey === startKey) {
      return;
    }
    attendanceWorkStartPendingKey = startKey;
    void markLaboratoryAttendanceWorkStarted(laboratoryConfig.value.labName)
      .then((session) => {
        attendanceSession.value = session;
      })
      .catch((error) => {
        attendanceLoginError.value = formatErrorMessage(error);
        attendanceWorkStartPendingKey = "";
      });
  };

  onBeforeUnmount(clearAttendanceLogoutTimer);

  return {
    applyExperimentStartAttendance,
    attendanceLoggedIn,
    attendanceLoginError,
    attendanceLoginMode,
    attendanceLoginModalOpen,
    attendanceLoginPassword,
    attendanceLoginUsername,
    attendanceLogoutCountdown,
    attendanceLogoutPromptOpen,
    attendanceQrInputRef,
    attendanceQrPayload,
    attendanceSession,
    attendanceStatus,
    attendanceSubmitting,
    attendanceWorkStartedAt,
    clearAttendanceLogoutTimer,
    closeAttendanceLogin,
    loadAttendanceSession,
    logoutAttendance,
    openAttendanceLogin,
    openAttendanceLogoutPrompt,
    resetAttendanceInteraction,
    rollbackOptimisticAttendanceWork,
    runWithAttendance,
    setAttendanceLoginMode,
    setSuppressNextAttendanceWorkStart,
    startAttendanceWorkOptimistically,
    startWorkForRunningExperiment,
    submitAttendanceLogin,
    submitAttendanceQrLogin,
  };
}

export { useLaboratoryAttendance };
