<template>
  <div class="system-page">
  <section class="grid cols-3 stagger">
    <div v-for="card in summaryCards" :key="card.label" class="card">
      <div class="muted">{{ card.label }}</div>
      <div class="kpi">{{ card.value }}</div>
      <div class="muted">{{ card.note }}</div>
    </div>
  </section>

  <section class="card section system-roles-card">
    <h3>角色权限矩阵</h3>
    <div class="toolbar">
      <input v-model="query" class="search-input" placeholder="筛选角色/权限" />
      <button class="action-btn" data-testid="open-role-modal" type="button" @click="openRoleModal">新增角色</button>
    </div>
    <table class="table" id="role-table">
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort :data-sort-dir="sortKey === 'name' ? sortDirection : ''" @click="toggleSort('name')">角色</th>
          <th data-sort :data-sort-dir="sortKey === 'scope' ? sortDirection : ''" @click="toggleSort('scope')">范围</th>
          <th data-sort :data-sort-dir="sortKey === 'keyPermissions' ? sortDirection : ''" @click="toggleSort('keyPermissions')">关键权限</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(role, index) in visibleRoleRows" :key="role.id">
          <td>{{ index + 1 }}</td>
          <td>{{ role.name }}</td>
          <td>{{ role.scope }}</td>
          <td>{{ role.keyPermissions }}</td>
          <td>
            <button class="action-link" :data-testid="`open-role-drawer-${index}`" type="button" @click="openRoleDrawer(role)">
              编辑
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card section system-settings-card">
    <h3>基础配置</h3>
    <div class="form-grid">
      <div class="form-field">
        <label>班次配置</label>
        <input :value="settings.shiftConfig" type="text" placeholder="白班 08:00-16:00" />
      </div>
      <div class="form-field">
        <label>数据保留周期</label>
        <input :value="settings.retentionPeriod" type="text" placeholder="例如：36 个月" />
      </div>
      <div class="form-field">
        <label>通知方式</label>
        <select>
          <option :selected="settings.notificationChannel === '站内通知'">站内通知</option>
          <option :selected="settings.notificationChannel === '短信'">短信</option>
          <option :selected="settings.notificationChannel === '邮件'">邮件</option>
        </select>
      </div>
    </div>
  </section>

  <AppModal :open="roleModalOpen" title="新增角色" @close="closeRoleModal">
    <div class="form-grid">
      <div class="form-field">
        <label>角色名称</label>
        <input :value="createRoleFields.name" type="text" placeholder="例如：数据审核员" />
      </div>
      <div class="form-field">
        <label>权限范围</label>
        <input :value="createRoleFields.scope" type="text" placeholder="过程 + 数据" />
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>关键权限</label>
        <textarea :value="createRoleFields.keyPermissions" placeholder="列出关键操作权限"></textarea>
      </div>
    </div>
    <template #footer>
      <button class="action-btn" type="button" @click="closeRoleModal">保存</button>
      <button class="action-btn secondary" type="button" @click="closeRoleModal">取消</button>
    </template>
  </AppModal>

  <AppDrawer :open="roleDrawerOpen" title="角色详情" @close="closeRoleDrawer">
    <div class="form-grid">
      <div class="form-field">
        <label>角色名称</label>
        <input :value="editRoleFields.name" type="text" placeholder="排程员" />
      </div>
      <div class="form-field">
        <label>范围</label>
        <input :value="editRoleFields.scope" type="text" placeholder="任务 + 排程" />
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>权限说明</label>
        <textarea :value="editRoleFields.keyPermissions" placeholder="更新权限描述"></textarea>
      </div>
    </div>
  </AppDrawer>
  </div>
</template>

<script setup>
import AppDrawer from "@/components/shared/AppDrawer.vue";
import AppModal from "@/components/shared/AppModal.vue";
import { useSystemPage } from "./useSystemPage";

const {
  closeRoleDrawer,
  closeRoleModal,
  createRoleFields,
  editRoleFields,
  openRoleDrawer,
  openRoleModal,
  query,
  roleDrawerOpen,
  roleModalOpen,
  settings,
  summaryCards,
  sortDirection,
  sortKey,
  toggleSort,
  visibleRoleRows,
} = useSystemPage();
</script>
