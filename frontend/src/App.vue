<template>
  <RouterView v-if="isAuthLayout" />

  <div v-else-if="isCentralModule" class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        七二四新火工区信息化中控管理系统
        <span>实验室中控管理</span>
      </div>
      <nav class="nav">
        <RouterLink class="nav-link" :class="{ active: isActive('dashboard') }" to="/">中控总览</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('task-overview') }" to="/task-overview">任务/托盘总览</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('tasks') }" to="/tasks">任务受理</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('schedule') }" to="/schedule">排程看板</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('samples') }" to="/samples">样品管理</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('process') }" to="/process">试验过程</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('devices') }" to="/devices">设备资源</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('data') }" to="/data">试验数据</RouterLink>
        <RouterLink class="nav-link" :class="{ active: isActive('system') }" to="/system">系统信息</RouterLink>
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
          <RouterLink class="action-btn" to="/tasks#task-modal" data-modal-open="task-modal">新建任务</RouterLink>
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
          v-if="currentModule === 'visual'"
          class="nav-link"
          :class="{ active: isActive('visualization') }"
          to="/visualization"
        >
          可视化管理
        </RouterLink>
        <RouterLink
          v-if="currentModule === 'staging'"
          class="nav-link"
          :class="{ active: isActive('staging-management') }"
          to="/staging-management"
        >
          暂存间管理
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
import { computed, nextTick, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { clearAuthSession, readAuthSession } from "@/auth";
import { bootLegacyUI } from "./legacy/boot.js";

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

const isActive = (name) => route.name === name;
const refreshPage = () => {
  window.location.reload();
};
const handleLogout = () => {
  clearAuthSession();
  router.replace("/login");
};

const runLegacyBoot = async () => {
  if (isAuthLayout.value || !isCentralModule.value) {
    return;
  }
  await nextTick();
  await bootLegacyUI();
};

onMounted(runLegacyBoot);
watch(
  () => [route.path, currentModule.value, isAuthLayout.value],
  () => {
    runLegacyBoot();
  }
);
</script>
