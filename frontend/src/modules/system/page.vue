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
    <h3 v-app-icon="{ name: 'users' }">人员信息维护</h3>
    <div class="toolbar">
      <input ref="employeeSearchInput" v-model="query" class="search-input" placeholder="筛选员工/账号/角色" />
      <button v-app-icon="{ name: 'users', placement: 'button' }" class="action-btn" data-testid="open-employee-modal" type="button" @click="openEmployeeModal">新增员工账号</button>
    </div>
    <div class="system-paginated-table-stage" :class="{ 'system-paginated-table-stage--empty': !visibleEmployeeRows.length }">
      <table class="table" id="employee-table">
        <thead>
          <tr>
            <th>序号</th>
            <th data-sort :data-sort-dir="sortKey === 'employeeName' ? sortDirection : ''" :aria-sort="sortKey === 'employeeName' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'"><button class="table-sort-button" type="button" @click="toggleSort('employeeName')">员工</button></th>
            <th data-sort :data-sort-dir="sortKey === 'username' ? sortDirection : ''" :aria-sort="sortKey === 'username' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'"><button class="table-sort-button" type="button" @click="toggleSort('username')">账号</button></th>
            <th data-sort :data-sort-dir="sortKey === 'roleName' ? sortDirection : ''" :aria-sort="sortKey === 'roleName' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'"><button class="table-sort-button" type="button" @click="toggleSort('roleName')">角色</button></th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(employee, index) in visibleEmployeeRows" :key="employee.id">
            <td>{{ (employeeCurrentPage - 1) * 8 + index + 1 }}</td>
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
    </div>
    <div v-if="!visibleEmployeeRows.length" class="system-empty-state" data-testid="employee-empty-state" role="status">
      <strong>{{ query.trim() ? "没有匹配的员工" : "暂无员工账号" }}</strong>
      <p>{{ query.trim() ? `未找到与“${query.trim()}”匹配的姓名、账号或角色，请更换关键词。` : "新增员工账号后，可在这里查看和维护人员信息。" }}</p>
      <button v-if="query.trim()" class="action-btn secondary" data-testid="employee-clear-query" type="button" @click="clearEmployeeQuery">清除筛选</button>
    </div>
    <div class="system-pagination-footer">
      <span class="system-pagination-range" data-testid="employee-pagination-range">
        显示第 <strong>{{ employeePageRange.start }}–{{ employeePageRange.end }}</strong> 条，共 <strong>{{ employeePageRange.total }}</strong> 条
      </span>
      <AppPagination
        :current-page="employeeCurrentPage"
        :page-count="employeePageCount"
        data-testid="employee-pagination"
        @change="setEmployeePage"
      />
    </div>
  </section>

  <section class="card section system-worktime-card">
    <div class="system-worktime-heading">
      <h3>人员工作时间一览表</h3>
      <button v-app-icon="{ name: 'history', placement: 'button' }" class="action-btn" data-testid="open-employee-operation-logs" type="button" @click="openEmployeeOperationLogs">员工工作日志</button>
    </div>
    <div class="system-paginated-table-stage">
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
          <tr v-for="(employee, index) in visibleWorkTimeRows" :key="`worktime-${employee.id}`">
            <td>{{ (workTimeCurrentPage - 1) * 8 + index + 1 }}</td>
            <td>{{ employee.employeeName }}</td>
            <td>{{ employee.username }}</td>
            <td>{{ employee.roleName }}</td>
            <td>{{ employee.todayWorkTime }}</td>
            <td>{{ employee.currentLabName || "-" }}</td>
            <td><span class="status" :class="{ warn: !employee.online }">{{ employee.statusLabel }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="system-pagination-footer">
      <span class="system-pagination-range" data-testid="worktime-pagination-range">
        显示第 <strong>{{ workTimePageRange.start }}–{{ workTimePageRange.end }}</strong> 条，共 <strong>{{ workTimePageRange.total }}</strong> 条
      </span>
      <AppPagination
        :current-page="workTimeCurrentPage"
        :page-count="workTimePageCount"
        data-testid="worktime-pagination"
        @change="setWorkTimePage"
      />
    </div>
  </section>

  <AppModal :open="employeeModalOpen" title="新增员工账号" @close="closeEmployeeModal">
    <fieldset class="form-grid system-employee-fields" :disabled="createEmployeeSubmitting">
      <div class="form-field">
        <label for="create-employee-name">员工姓名</label>
        <input id="create-employee-name" v-model="createEmployeeFields.employeeName" data-testid="employee-name-input" type="text" placeholder="例如：张三" />
      </div>
      <div class="form-field">
        <label for="create-employee-username">账号</label>
        <input id="create-employee-username" v-model="createEmployeeFields.username" data-testid="employee-username-input" type="text" placeholder="例如：zhangsan" />
      </div>
      <div class="form-field">
        <label for="create-employee-password">密码</label>
        <input id="create-employee-password" v-model="createEmployeeFields.password" data-testid="employee-password-input" type="password" placeholder="请输入初始密码" autocomplete="new-password" />
      </div>
      <div class="form-field">
        <label for="create-employee-role">角色</label>
        <select id="create-employee-role" v-model="createEmployeeFields.roleName" data-testid="employee-role-select">
          <option v-for="role in employeeRoleOptions" :key="role" :value="role">{{ role }}</option>
        </select>
      </div>
      <div class="form-field">
        <label for="create-employee-admin-username">管理员账号</label>
        <input id="create-employee-admin-username" v-model="createEmployeeAdminFields.adminUsername" data-testid="create-employee-admin-username" type="text" placeholder="请输入管理员账号" />
      </div>
      <div class="form-field">
        <label for="create-employee-admin-password">管理员密码</label>
        <input id="create-employee-admin-password" v-model="createEmployeeAdminFields.adminPassword" data-testid="create-employee-admin-password" type="password" placeholder="请输入管理员密码" autocomplete="off" />
      </div>
    </fieldset>
    <AppFeedback
      :message="createEmployeeError"
      tone="error"
      data-testid="employee-create-error"
      @close="createEmployeeError = ''"
    />
    <template #footer>
      <button class="action-btn" data-testid="employee-save" type="button" :disabled="createEmployeeSubmitting" :aria-busy="createEmployeeSubmitting" @click="saveNewEmployee">{{ createEmployeeSubmitting ? "保存中…" : "保存" }}</button>
      <button class="action-btn secondary" type="button" :disabled="createEmployeeSubmitting" @click="closeEmployeeModal">取消</button>
    </template>
  </AppModal>

  <AppModal :open="employeeDrawerOpen" title="员工账号详情" content-class="system-employee-edit-modal" @close="closeEmployeeDrawer">
    <fieldset class="system-employee-fields system-employee-sections" :disabled="adminActionSubmitting">
      <fieldset class="form-grid system-employee-section">
        <legend>员工资料</legend>
      <div class="form-field">
        <label for="edit-employee-name">员工姓名</label>
        <input id="edit-employee-name" v-model="editEmployeeFields.employeeName" data-testid="edit-employee-name" type="text" placeholder="张三" />
      </div>
      <div class="form-field">
        <label for="edit-employee-username">账号</label>
        <input id="edit-employee-username" v-model="editEmployeeFields.username" data-testid="edit-employee-username" type="text" placeholder="zhangsan" />
      </div>
      <div class="form-field">
        <label for="edit-employee-role">角色</label>
        <select id="edit-employee-role" v-model="editEmployeeFields.roleName" data-testid="edit-employee-role">
          <option v-for="role in employeeRoleOptions" :key="role" :value="role">{{ role }}</option>
        </select>
      </div>
      </fieldset>
      <fieldset class="form-grid system-employee-section">
        <legend>管理员身份验证</legend>
        <p class="helper system-employee-section-note">保存修改、重置密码和删除账号均需管理员验证。</p>
      <div class="form-field">
        <label for="employee-admin-username">管理员账号</label>
        <input id="employee-admin-username" v-model="adminActionFields.adminUsername" data-testid="admin-username-input" type="text" placeholder="admin" />
      </div>
      <div class="form-field">
        <label for="employee-admin-password">管理员密码</label>
        <input id="employee-admin-password" v-model="adminActionFields.adminPassword" data-testid="admin-password-input" type="password" placeholder="请输入管理员密码" autocomplete="off" />
      </div>
      </fieldset>
      <fieldset class="form-grid system-employee-section">
        <legend>修改密码</legend>
      <div class="form-field">
        <label for="employee-new-password">新密码（留空则不修改）</label>
        <input id="employee-new-password" v-model="adminActionFields.newPassword" data-testid="reset-password-input" type="password" placeholder="请输入新密码" autocomplete="new-password" aria-describedby="employee-password-reset-note" />
      </div>
        <p id="employee-password-reset-note" class="helper system-employee-section-note">填写新密码后点击“保存修改”可与员工资料一起保存，也可单独点击“重置密码”。</p>
      </fieldset>
    </fieldset>
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
        class="action-btn system-employee-save"
        data-testid="employee-save-changes"
        type="button"
        :disabled="!employeeHasChanges || adminActionSubmitting"
        :aria-busy="employeeSaving"
        @click="saveEmployeeChanges"
      >
        {{ employeeSaving ? "保存中…" : "保存修改" }}
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
    </template>
  </AppModal>

  <AppModal :open="employeeOperationLogsOpen" content-class="system-operation-log-modal" data-testid="employee-operation-logs-modal" title="员工工作日志" @close="closeEmployeeOperationLogs">
    <fieldset class="form-grid system-employee-fields" :disabled="operationLogSubmitting">
      <div class="form-field"><label for="operation-log-admin-username">管理员账号</label><input id="operation-log-admin-username" v-model="operationLogFilters.adminUsername" data-testid="operation-log-admin-username" type="text" placeholder="admin" /></div>
      <div class="form-field"><label for="operation-log-admin-password">管理员密码</label><input id="operation-log-admin-password" v-model="operationLogFilters.adminPassword" data-testid="operation-log-admin-password" type="password" placeholder="请输入管理员密码" autocomplete="off" /></div>
      <div class="form-field"><label id="operation-log-date-label" for="operation-log-date">日期</label><PickerOnlyInput id="operation-log-date" v-model="operationLogFilters.date" aria-labelledby="operation-log-date-label" display-slash-date data-testid="operation-log-date" type="date" /></div>
      <div class="form-field">
        <label for="operation-log-employee">员工</label>
        <button id="operation-log-employee" class="system-multi-select__trigger" data-testid="operation-log-employee" type="button" aria-haspopup="dialog" @click="openOperationLogScopeSelector('employee')">
          {{ operationLogEmployeeLabel }}
        </button>
      </div>
      <div class="form-field">
        <label for="operation-log-lab">试验间</label>
        <button id="operation-log-lab" class="system-multi-select__trigger" data-testid="operation-log-lab" type="button" aria-haspopup="dialog" @click="openOperationLogScopeSelector('lab')">
          {{ operationLogLabLabel }}
        </button>
      </div>
    </fieldset>
    <AppFeedback v-if="operationLogError" :message="operationLogError" tone="error" @close="operationLogError = ''" />
    <div class="system-operation-log-table-wrap">
      <table class="table" data-testid="employee-operation-logs-table">
        <thead><tr><th>员工</th><th>账号</th><th>试验间</th><th>操作</th><th>任务/试验/托盘</th><th>时间</th><th>来源</th></tr></thead>
        <tbody>
          <tr v-if="!operationLogRows.length"><td colspan="7" class="muted" data-testid="operation-log-empty" role="status">{{ operationLogEmptyMessage }}</td></tr>
          <tr v-for="log in operationLogRows" :key="log.id">
            <td>{{ log.employeeName || "/" }}</td><td>{{ log.username || "/" }}</td><td>{{ log.labName || "/" }}</td><td>{{ log.action || "/" }}</td>
            <td>{{ [log.taskCode, log.experimentCode, log.trayNo].filter(Boolean).join(" / ") || "/" }}</td><td>{{ formatLocalDateTime(log.operatedAt) || "/" }}</td><td>{{ log.source || "/" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #footer>
      <button class="action-btn" data-testid="query-employee-operation-logs" type="button" :disabled="operationLogSubmitting" :aria-busy="operationLogSubmitting" @click="loadEmployeeOperationLogs">{{ operationLogSubmitting ? "查询中…" : "查询" }}</button>
    </template>
  </AppModal>

  <SystemOperationLogScopeWizard
    :open="operationLogScopeSelectorOpen"
    :initial-step="operationLogScopeInitialStep"
    :employee-names="operationLogFilters.employeeNames"
    :employee-options="operationLogEmployeeOptions"
    :lab-names="operationLogFilters.labNames"
    :lab-options="operationLogLabOptions"
    @close="closeOperationLogScopeSelector"
    @confirm="confirmOperationLogScope"
  />
  </div>
</template>

<script setup>
import { vAppIcon } from "@/directives/appIcon";
import { ref } from "vue";

defineOptions({
  name: "SystemPage",
});

import AppModal from "@/components/shared/AppModal.vue";
import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";
import { formatLocalDateTime } from "@/lib/dateTime";
import SystemOperationLogScopeWizard from "./SystemOperationLogScopeWizard.vue";
import { useSystemPage } from "./useSystemPage";

const {
  adminActionError,
  adminActionFields,
  adminActionSubmitting,
  adminActionSuccess,
  closeEmployeeDrawer,
  closeEmployeeModal,
  closeEmployeeOperationLogs,
  createEmployeeError,
  createEmployeeFields,
  createEmployeeAdminFields,
  createEmployeeSubmitting,
  deleteEmployee,
  downloadEmployeeQrCode,
  editEmployeeFields,
  employeeHasChanges,
  employeeSaving,
  saveEmployeeChanges,
  employeeCurrentPage,
  employeePageCount,
  employeePageRange,
  employeeRoleOptions,
  openEmployeeDrawer,
  openEmployeeModal,
  query,
  resetEmployeePassword,
  employeeDrawerOpen,
  employeeModalOpen,
  employeeOperationLogsOpen,
  employeeQrModalOpen,
  closeEmployeeQrModal,
  saveNewEmployee,
  setEmployeePage,
  setWorkTimePage,
  openEmployeeQrModal,
  openEmployeeOperationLogs,
  summaryCards,
  sortDirection,
  sortKey,
  qrEmployee,
  qrError,
  qrPayload,
  qrSubmitting,
  qrSvg,
  operationLogError,
  operationLogEmptyMessage,
  operationLogEmployeeLabel,
  operationLogEmployeeOptions,
  operationLogFilters,
  operationLogLabLabel,
  operationLogLabOptions,
  operationLogScopeInitialStep,
  operationLogScopeSelectorOpen,
  operationLogRows,
  operationLogSubmitting,
  closeOperationLogScopeSelector,
  confirmOperationLogScope,
  loadEmployeeOperationLogs,
  openOperationLogScopeSelector,
  resetEmployeeQrToken,
  toggleSort,
  visibleEmployeeRows,
  visibleWorkTimeRows,
  workTimeCurrentPage,
  workTimePageCount,
  workTimePageRange,
} = useSystemPage();

const employeeSearchInput = ref(null);
const clearEmployeeQuery = () => {
  query.value = "";
  employeeSearchInput.value?.focus();
};
</script>
