<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        七二四新火工区信息化中控管理系统
        <span>实验室中控管理</span>
      </div>
      <nav class="nav">
        <RouterLink class="nav-link" :class="{ active: isActive('dashboard') }" to="/">中控总览</RouterLink>
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
        </div>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { bootLegacyUI } from "./legacy/boot.js";

const route = useRoute();

const pageTitle = computed(() => route.meta?.title || "七二四新火工区信息化中控管理系统");
const pageSubtitle = computed(() => route.meta?.subtitle || "");

const isActive = (name) => route.name === name;

const runLegacyBoot = async () => {
  await nextTick();
  await bootLegacyUI();
};

onMounted(runLegacyBoot);
watch(
  () => route.path,
  () => {
    runLegacyBoot();
  }
);
</script>
