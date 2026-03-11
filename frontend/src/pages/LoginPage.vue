<template>
  <section class="login-wrap">
    <div class="login-card">
      <div class="login-brand">七二四新火工区信息化中控管理系统</div>
      <div class="login-subtitle">统一登录入口</div>
      <form class="login-form" @submit.prevent="submitLogin">
        <label class="login-field">
          <span>账号</span>
          <input v-model="username" type="text" autocomplete="username" placeholder="请输入账号" />
        </label>
        <label class="login-field">
          <span>密码</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" />
        </label>
        <label class="login-field">
          <span>界面</span>
          <select v-model="moduleKey">
            <option value="central">中控管理</option>
            <option value="visual">可视化管理</option>
            <option value="staging">暂存间管理</option>
          </select>
        </label>
        <button class="action-btn login-submit" type="submit" :disabled="submitting">
          {{ submitting ? "登录中..." : "登录" }}
        </button>
      </form>
      <div v-if="errorMessage" class="form-alert">{{ errorMessage }}</div>
    </div>
  </section>
</template>

<script setup>
import { useRoute, useRouter } from "vue-router";
import { loginWithCredentials, resolveModuleHome } from "@/auth";
import { useLoginForm } from "@/composables/useLoginForm";

const router = useRouter();
const route = useRoute();
const redirectPath =
  typeof route.query.redirect === "string" && route.query.redirect.trim() ? route.query.redirect.trim() : "";
const { errorMessage, moduleKey, password, submitLogin, submitting, username } = useLoginForm({
  login: loginWithCredentials,
  navigate: (target) => router.replace(target),
  redirectPath,
  resolveModuleHome,
});
</script>
