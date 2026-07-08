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
    <h3>人员信息维护</h3>
    <div class="toolbar">
      <input v-model="query" class="search-input" placeholder="筛选员工/账号/角色" />
      <button class="action-btn" data-testid="open-employee-modal" type="button" @click="openEmployeeModal">新增员工账号</button>
    </div>
    <table class="table" id="employee-table">
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort :data-sort-dir="sortKey === 'employeeName' ? sortDirection : ''" @click="toggleSort('employeeName')">员工</th>
          <th data-sort :data-sort-dir="sortKey === 'username' ? sortDirection : ''" @click="toggleSort('username')">账号</th>
          <th data-sort :data-sort-dir="sortKey === 'roleName' ? sortDirection : ''" @click="toggleSort('roleName')">角色</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(employee, index) in visibleEmployeeRows" :key="employee.id">
          <td>{{ index + 1 }}</td>
          <td>{{ employee.employeeName }}</td>
          <td>{{ employee.username }}</td>
          <td>{{ employee.roleName }}</td>
          <td><span class="status" :class="{ warn: !employee.online }">{{ employee.statusLabel }}</span></td>
          <td>
            <div class="system-table-actions">
              <button class="action-link" :data-testid="`open-employee-drawer-${index}`" type="button" @click="openEmployeeDrawer(employee)">
                编辑
              </button>
              <button class="action-link" :data-testid="`employee-qr-code-${index}`" type="button" @click="openEmployeeQrModal(employee)">
                二维码
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card section system-worktime-card">
    <h3>人员工作时间一览表</h3>
    <table class="table" id="employee-worktime-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>员工</th>
          <th>账号</th>
          <th>角色</th>
          <th>今日工作时间</th>
          <th>当前登录试验间</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(employee, index) in workTimeRows" :key="`worktime-${employee.id}`">
          <td>{{ index + 1 }}</td>
          <td>{{ employee.employeeName }}</td>
          <td>{{ employee.username }}</td>
          <td>{{ employee.roleName }}</td>
          <td>{{ employee.todayWorkTime }}</td>
          <td>{{ employee.currentLabName || "-" }}</td>
          <td><span class="status" :class="{ warn: !employee.online }">{{ employee.statusLabel }}</span></td>
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

  <AppModal :open="employeeModalOpen" title="新增员工账号" @close="closeEmployeeModal">
    <div class="form-grid">
      <div class="form-field">
        <label>员工姓名</label>
        <input v-model="createEmployeeFields.employeeName" data-testid="employee-name-input" type="text" placeholder="例如：张三" />
      </div>
      <div class="form-field">
        <label>账号</label>
        <input v-model="createEmployeeFields.username" data-testid="employee-username-input" type="text" placeholder="例如：zhangsan" />
      </div>
      <div class="form-field">
        <label>密码</label>
        <input v-model="createEmployeeFields.password" data-testid="employee-password-input" type="password" placeholder="请输入初始密码" />
      </div>
      <div class="form-field">
        <label>角色</label>
        <select v-model="createEmployeeFields.roleName" data-testid="employee-role-select">
          <option v-for="role in employeeRoleOptions" :key="role" :value="role">{{ role }}</option>
        </select>
      </div>
    </div>
    <AppFeedback
      :message="createEmployeeError"
      tone="error"
      data-testid="employee-create-error"
      @close="createEmployeeError = ''"
    />
    <template #footer>
      <button class="action-btn" data-testid="employee-save" type="button" @click="saveNewEmployee">保存</button>
      <button class="action-btn secondary" type="button" @click="closeEmployeeModal">取消</button>
    </template>
  </AppModal>

  <AppModal :open="employeeDrawerOpen" title="员工账号详情" @close="closeEmployeeDrawer">
    <div class="form-grid">
      <div class="form-field">
        <label>员工姓名</label>
        <input :value="editEmployeeFields.employeeName" type="text" placeholder="张三" />
      </div>
      <div class="form-field">
        <label>账号</label>
        <input :value="editEmployeeFields.username" type="text" placeholder="zhangsan" />
      </div>
      <div class="form-field">
        <label>角色</label>
        <select :value="editEmployeeFields.roleName" disabled>
          <option v-for="role in employeeRoleOptions" :key="role" :value="role">{{ role }}</option>
        </select>
      </div>
      <div class="form-field">
        <label>管理员账号</label>
        <input v-model="adminActionFields.adminUsername" data-testid="admin-username-input" type="text" placeholder="admin" />
      </div>
      <div class="form-field">
        <label>管理员密码</label>
        <input v-model="adminActionFields.adminPassword" data-testid="admin-password-input" type="password" placeholder="请输入管理员密码" />
      </div>
      <div class="form-field">
        <label>新密码</label>
        <input v-model="adminActionFields.newPassword" data-testid="reset-password-input" type="password" placeholder="用于重置员工密码" />
      </div>
    </div>
    <AppFeedback
      v-if="adminActionError"
      :message="adminActionError"
      tone="error"
      data-testid="employee-admin-action-feedback"
      @close="adminActionError = ''"
    />
    <AppFeedback
      v-if="adminActionSuccess"
      :message="adminActionSuccess"
      tone="success"
      data-testid="employee-admin-action-feedback"
      @close="adminActionSuccess = ''"
    />
    <template #footer>
      <button
        class="action-btn"
        data-testid="employee-reset-password"
        type="button"
        :disabled="adminActionSubmitting"
        @click="resetEmployeePassword"
      >
        重置密码
      </button>
      <button
        class="action-btn danger"
        data-testid="employee-delete"
        type="button"
        :disabled="adminActionSubmitting"
        @click="deleteEmployee"
      >
        删除账号
      </button>
      <button class="action-btn secondary" type="button" @click="closeEmployeeDrawer">关闭</button>
    </template>
  </AppModal>

  <AppModal :open="employeeQrModalOpen" data-testid="employee-qr-modal" title="员工登录二维码" @close="closeEmployeeQrModal">
    <div class="system-qr-modal">
      <div class="system-qr-summary">
        <div>
          <span class="muted">员工</span>
          <strong>{{ qrEmployee?.employeeName || "-" }}</strong>
        </div>
        <div>
          <span class="muted">账号</span>
          <strong>{{ qrEmployee?.username || "-" }}</strong>
        </div>
        <div>
          <span class="muted">二维码状态</span>
          <strong>{{ qrEmployee?.hasQrToken ? "已生成" : "未生成" }}</strong>
        </div>
      </div>
      <div v-if="qrSvg" class="system-qr-preview" v-html="qrSvg"></div>
      <div v-if="qrPayload" class="system-qr-payload" data-testid="employee-qr-payload">{{ qrPayload }}</div>
      <AppFeedback
        v-if="qrError"
        :message="qrError"
        tone="error"
        data-testid="employee-qr-error"
        @close="qrError = ''"
      />
    </div>
    <template #footer>
      <button class="action-btn" data-testid="employee-qr-reset" type="button" :disabled="qrSubmitting" @click="resetEmployeeQrToken">
        {{ qrEmployee?.hasQrToken ? "重置二维码" : "生成二维码" }}
      </button>
      <button
        class="action-btn secondary"
        data-testid="employee-qr-download"
        type="button"
        :disabled="!qrPayload"
        @click="downloadEmployeeQrCode"
      >
        下载图片
      </button>
      <button class="action-btn secondary" type="button" @click="closeEmployeeQrModal">关闭</button>
    </template>
  </AppModal>
  </div>
</template>

<script setup>
defineOptions({
  name: "SystemPage",
});

import AppModal from "@/components/shared/AppModal.vue";
import AppFeedback from "@/components/shared/AppFeedback.vue";
import { useSystemPage } from "./useSystemPage";

const {
  adminActionError,
  adminActionFields,
  adminActionSubmitting,
  adminActionSuccess,
  closeEmployeeDrawer,
  closeEmployeeModal,
  createEmployeeError,
  createEmployeeFields,
  deleteEmployee,
  downloadEmployeeQrCode,
  editEmployeeFields,
  employeeRoleOptions,
  openEmployeeDrawer,
  openEmployeeModal,
  query,
  resetEmployeePassword,
  employeeDrawerOpen,
  employeeModalOpen,
  employeeQrModalOpen,
  settings,
  closeEmployeeQrModal,
  saveNewEmployee,
  openEmployeeQrModal,
  summaryCards,
  sortDirection,
  sortKey,
  qrEmployee,
  qrError,
  qrPayload,
  qrSubmitting,
  qrSvg,
  resetEmployeeQrToken,
  toggleSort,
  visibleEmployeeRows,
  workTimeRows,
} = useSystemPage();
</script>
