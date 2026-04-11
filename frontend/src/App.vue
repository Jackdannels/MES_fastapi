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
        >
          <span class="nav-link-label">
            {{ navItem.route.meta?.title }}
            <span v-if="showTaskOverviewAlert(navItem.route.name)" class="nav-alert-dot" aria-hidden="true"></span>
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
          <button class="action-btn" data-testid="open-task-intake" type="button" @click="openTaskIntake">
            新建任务
          </button>
          <RouterLink class="action-btn secondary" to="/schedule">查看排程</RouterLink>
          <button class="action-btn secondary" type="button" @click="refreshPage">刷新</button>
          <button class="action-btn secondary" data-testid="app-logout" type="button" @click="handleLogout">退出登录</button>
        </div>
      </header>
      <RouterView />
    </main>
  </div>

  <div v-else class="app-shell">
    <aside class="sidebar">
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
          <button class="action-btn secondary" data-testid="app-logout" type="button" @click="handleLogout">退出登录</button>
        </div>
      </header>
      <RouterView />
    </main>
  </div>

  <ModuleExitDialog
    v-if="!isAuthLayout && !isBareModule"
    :current-module="currentModule"
    :open="exitDialogOpen"
    @close="closeExitDialog"
    @logout="confirmLogout"
    @switch-module="switchModule"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ModuleExitDialog from "@/components/shared/ModuleExitDialog.vue";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { MODULE_LABELS } from "@/lib/moduleCatalog";
import { getNavigationModules } from "@/modules";
import { logoutSession, readAuthSession, resolveModuleHome, switchSessionModule } from "@/auth";

const OVERDUE_MS = 24 * 60 * 60 * 1000;
const TRANSFER_STATUS_STORED = "已入库";

const parseTimeValue = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const normalizeText = (value) => String(value ?? "").trim();

const hasOverdueWaitingExperiment = (tasks, experiments, now = Date.now()) => {
  const taskByCode = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [normalizeText(task?.code), task]));

  return (Array.isArray(experiments) ? experiments : []).some((experiment) => {
    const task = taskByCode.get(normalizeText(experiment?.task_code));
    if (normalizeText(task?.transfer_status) !== TRANSFER_STATUS_STORED) {
      return false;
    }
    const startedAt = parseTimeValue(experiment?.unscheduled_since);
    return Number.isFinite(startedAt) && now - startedAt > OVERDUE_MS;
  });
};

const route = useRoute();
const router = useRouter();
const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.experiments]);
const exitDialogOpen = ref(false);
const hasTaskOverviewAlert = ref(false);
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
const centralNavigation = computed(() => getNavigationModules("central"));
const moduleNavigation = computed(() => getNavigationModules(currentModule.value));
const showTaskOverviewAlert = (routeName) => routeName === "task-overview" && hasTaskOverviewAlert.value;

const isActive = (name) => route.name === name;

const refreshTaskOverviewAlert = async () => {
  const snapshot = await loadSnapshot();
  hasTaskOverviewAlert.value = hasOverdueWaitingExperiment(
    snapshot[STORAGE_KEYS.tasks],
    snapshot[STORAGE_KEYS.experiments],
  );
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
  const result = await switchSessionModule(targetModule);
  if (!result.ok) {
    return;
  }
  await router.push(resolveModuleHome(targetModule));
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
