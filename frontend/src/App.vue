<template>
  <RouterView v-if="isAuthLayout" />

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
          {{ navItem.route.meta?.title }}
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
          <button class="action-btn secondary" type="button" @click="handleLogout">退出登录</button>
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
          <button class="action-btn secondary" type="button" @click="handleLogout">退出登录</button>
        </div>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { logoutSession, readAuthSession } from "@/auth";
import { getNavigationModules } from "@/modules";

const route = useRoute();
const router = useRouter();

const moduleLabelMap = {
  central: "中控管理",
  visual: "可视化管理",
  staging: "暂存间管理",
};

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
const moduleLabel = computed(() => moduleLabelMap[currentModule.value] || moduleLabelMap.central);
const isCentralModule = computed(() => currentModule.value === "central");
const centralNavigation = computed(() => getNavigationModules("central"));
const moduleNavigation = computed(() => getNavigationModules(currentModule.value));

const isActive = (name) => route.name === name;

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

const handleLogout = async () => {
  await logoutSession();
  router.replace("/login");
};
</script>
