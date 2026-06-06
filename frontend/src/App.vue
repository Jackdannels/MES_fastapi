<template>
  <RouterView v-if="isAuthLayout" />
  <RouterView v-else-if="isBareModule" />

  <div v-else-if="isCentralModule" class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        七二四新火工区信息化中控管理系统
        <span>实验室中控管理</span>
      </div>
      <nav class="nav">
        <RouterLink
          v-for="navItem in centralNavigation"
          :key="navItem.route.name"
          class="nav-link"
          :class="{ active: isActive(navItem.route.name) }"
          :to="navItem.route.path"
          @click="handleCentralNavClick(navItem, $event)"
        >
          <span class="nav-link-label">
            {{ navItem.route.meta?.title }}
            <span v-if="showTaskOverviewAlert(navItem.route.name)" class="nav-alert-dot" aria-hidden="true"></span>
            <span v-if="showScheduleExceptionAlert(navItem.route.name)" class="nav-alert-pill">
              异常 {{ pendingScheduleExceptionCount }}
            </span>
          </span>
        </RouterLink>
      </nav>
      <div class="sidebar-footer">
        已连接：Modbus
        <div class="badge-row">
          <span class="badge">自动采集</span>
          <span class="badge">固定报告</span>
        </div>
      </div>
    </aside>
    <main class="main">
      <header class="page-header">
        <div>
          <div class="eyebrow">中控中心</div>
          <h1>{{ pageTitle }}</h1>
          <p class="subtitle">{{ pageSubtitle }}</p>
        </div>
        <div class="header-actions">
          <button
            v-if="showTaskResetAction"
            class="action-btn secondary"
            data-testid="open-task-reset"
            type="button"
            @click="openTaskReset"
          >
            任务重置
          </button>
          <button
            v-if="showTaskIntakeAction"
            class="action-btn"
            data-testid="open-task-intake"
            type="button"
            @click="openTaskIntake"
          >
            新建任务
          </button>
          <button class="action-btn secondary" type="button" @click="refreshPage">刷新</button>
          <span class="header-actions-before-logout"></span>
          <button class="action-btn secondary" data-testid="app-logout" type="button" @click="handleLogout">退出登录</button>
        </div>
      </header>
      <RouterView />
    </main>
  </div>

  <div v-else class="app-shell">
    <aside v-if="!isStorageRoomModule && !isLaboratoryModule" class="sidebar">
      <div class="brand">
        七二四新火工区信息化中控管理系统
        <span>{{ moduleLabel }}</span>
      </div>
      <nav class="nav">
        <RouterLink
          v-for="navItem in moduleNavigation"
          :key="navItem.route.name"
          class="nav-link"
          :class="{ active: isActive(navItem.route.name) }"
          :to="navItem.route.path"
        >
          {{ navItem.route.meta?.title }}
        </RouterLink>
      </nav>
    </aside>
    <main class="main">
      <header class="page-header">
        <div>
          <div class="eyebrow">{{ moduleLabel }}</div>
          <h1>{{ pageTitle }}</h1>
          <p class="subtitle">{{ pageSubtitle }}</p>
        </div>
        <div class="header-actions">
          <span class="header-actions-before-logout"></span>
          <button
            v-if="isStagingModule"
            class="action-btn tray-error-sample-trigger"
            data-testid="staging-error-sample"
            type="button"
            @click="errorSample.open()"
          >
            出错样品处理
          </button>
          <button class="action-btn secondary" data-testid="app-logout" type="button" @click="handleLogout">退出登录</button>
        </div>
      </header>
      <RouterView />
    </main>
  </div>

  <ModuleExitDialog
    v-if="!isAuthLayout && !isBareModule"
    :current-module="currentModule"
    :current-lab-name="currentLabName"
    :open="exitDialogOpen"
    @close="closeExitDialog"
    @logout="confirmLogout"
    @switch-module="switchModule"
  />
  <TrayErrorSampleDialog
    v-if="!isAuthLayout && !isBareModule && isStagingModule"
    :model="errorSample"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ModuleExitDialog from "@/components/shared/ModuleExitDialog.vue";
import TrayErrorSampleDialog from "@/components/shared/TrayErrorSampleDialog.vue";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useTrayErrorSampleHandling } from "@/composables/useTrayErrorSampleHandling";
import { findFirstOverdueWaitingTaskCode, hasOverdueWaitingExperiment } from "@/lib/taskOverviewAlerts";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { MODULE_LABELS } from "@/lib/moduleCatalog";
import { getNavigationModules } from "@/modules";
import { logoutSession, readAuthSession, resolveModuleHome, switchSessionModule } from "@/auth";

const TASK_RESET_EVENT = "mes:open-task-reset";
const LABORATORY_SELECTED_LAB_STORAGE_KEY = "mes_laboratory_selected_lab_v1";

const route = useRoute();
const router = useRouter();
const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.experiments, STORAGE_KEYS.schedules, STORAGE_KEYS.samples, STORAGE_KEYS.conflicts]);
const exitDialogOpen = ref(false);
const hasTaskOverviewAlert = ref(false);
const pendingScheduleExceptionCount = ref(0);
const errorSample = useTrayErrorSampleHandling();
let navAlertTimer = null;

const pageTitle = computed(() => route.meta?.title || "七二四新火工区信息化中控管理系统");
const pageSubtitle = computed(() => route.meta?.subtitle || "");
const isAuthLayout = computed(() => route.meta?.layout === "auth");
const currentModule = computed(() => {
  const routeModule = route.meta?.module;
  if (routeModule) {
    return routeModule;
  }
  const session = readAuthSession();
  return session?.module || "central";
});
const moduleLabel = computed(() => MODULE_LABELS[currentModule.value] || MODULE_LABELS.central);
const isBareModule = computed(() => currentModule.value === "handover");
const isCentralModule = computed(() => currentModule.value === "central");
const isStagingModule = computed(() => currentModule.value === "staging");
const isAppearanceModule = computed(() => currentModule.value === "appearance");
const isStorageRoomModule = computed(() => isStagingModule.value || isAppearanceModule.value);
const isLaboratoryModule = computed(() => currentModule.value === "laboratory");
const centralNavigation = computed(() => getNavigationModules("central"));
const moduleNavigation = computed(() => getNavigationModules(currentModule.value));
const showTaskResetAction = computed(() => isCentralModule.value && route.name === "tasks");
const showTaskIntakeAction = computed(() => isCentralModule.value && route.name === "tasks");
const showTaskOverviewAlert = (routeName) => routeName === "task-overview" && hasTaskOverviewAlert.value;
const showScheduleExceptionAlert = (routeName) => routeName === "schedule" && pendingScheduleExceptionCount.value > 0;
const currentLabName = computed(() => {
  if (!isLaboratoryModule.value) {
    return "";
  }
  if (typeof route.query?.lab === "string" && route.query.lab.trim()) {
    return route.query.lab.trim();
  }
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return "";
  }
  return String(window.localStorage.getItem(LABORATORY_SELECTED_LAB_STORAGE_KEY) || "").trim();
});

const isActive = (name) => route.name === name;

const refreshTaskOverviewAlert = async () => {
  const snapshot = await loadSnapshot();
  hasTaskOverviewAlert.value = hasOverdueWaitingExperiment(
    snapshot[STORAGE_KEYS.tasks],
    snapshot[STORAGE_KEYS.experiments],
    snapshot[STORAGE_KEYS.schedules],
    Date.now(),
    snapshot[STORAGE_KEYS.samples],
  );
  pendingScheduleExceptionCount.value = (Array.isArray(snapshot[STORAGE_KEYS.conflicts]) ? snapshot[STORAGE_KEYS.conflicts] : [])
    .filter((entry) => String(entry?.status || "").trim() === "pending")
    .length;
};

const handleCentralNavClick = async (navItem, event) => {
  if (navItem?.route?.name !== "task-overview" || !hasTaskOverviewAlert.value) {
    return;
  }

  event.preventDefault();
  const snapshot = await loadSnapshot();
  const highlightedTaskCode = findFirstOverdueWaitingTaskCode(
    snapshot[STORAGE_KEYS.tasks],
    snapshot[STORAGE_KEYS.experiments],
    snapshot[STORAGE_KEYS.schedules],
    Date.now(),
    snapshot[STORAGE_KEYS.samples],
  );

  await router
    .push(
      highlightedTaskCode
        ? {
            path: navItem.route.path,
            query: { highlightTask: highlightedTaskCode },
          }
        : navItem.route.path,
    )
    .catch(() => {});
};

const openTaskIntake = async () => {
  const target = { path: "/tasks", hash: "#task-intake-modal" };

  if (route.path === target.path) {
    window.dispatchEvent(new CustomEvent("mes:open-task-intake"));
    if (route.hash !== target.hash) {
      void router.push(target).catch(() => {});
    }
    return;
  }

  try {
    await router.push(target);
  } finally {
    window.dispatchEvent(new CustomEvent("mes:open-task-intake"));
  }
};

const openTaskReset = () => {
  window.dispatchEvent(new CustomEvent(TASK_RESET_EVENT));
};

const refreshPage = () => {
  window.location.reload();
};

const handleLogout = () => {
  exitDialogOpen.value = true;
};

const closeExitDialog = () => {
  exitDialogOpen.value = false;
};

const confirmLogout = async () => {
  closeExitDialog();
  await logoutSession();
  router.replace("/login");
};

const switchModule = async (targetModule) => {
  closeExitDialog();
  const module = typeof targetModule === "string" ? targetModule : targetModule?.module;
  const labName = typeof targetModule === "object" && targetModule !== null ? targetModule.labName : "";

  const result = await switchSessionModule(module);
  if (!result.ok) {
    return;
  }

  if (module === "laboratory" && labName) {
    await router.push({ path: "/laboratory", query: { lab: labName } });
    return;
  }

  await router.push(resolveModuleHome(module));
};

onMounted(() => {
  void refreshTaskOverviewAlert();
  navAlertTimer = window.setInterval(() => {
    void refreshTaskOverviewAlert();
  }, 5000);
});

onBeforeUnmount(() => {
  if (navAlertTimer) {
    window.clearInterval(navAlertTimer);
  }
});
</script>
