<template>
  <div class="tasks-page">
  <section class="grid cols-3 stagger">
    <div class="card">
      <div class="muted">外部委托</div>
      <div class="kpi" id="task-external-count">{{ metrics.externalCount }}</div>
      <div class="muted">等待到样</div>
    </div>
    <div class="card">
      <div class="muted">内部新增</div>
      <div class="kpi" id="task-internal-count">{{ metrics.internalCount }}</div>
      <div class="muted">研发/质控</div>
    </div>
    <div class="card">
      <div class="muted">待排程</div>
      <div class="kpi" id="task-unscheduled-count">{{ metrics.unscheduledLabel }}</div>
      <div class="muted">需设备空闲</div>
    </div>
  </section>

  <section class="card section tasks-list-card">
    <h3>总任务清单</h3>
    <div class="toolbar">
      <input v-model="query" class="search-input" id="task-list-search" placeholder="筛选任务编号/实验摘要/样品编号" />
      <select v-model="filterTestType" class="search-input" id="task-list-filter-test-type">
        <option value="">全部实验类型</option>
        <option v-for="option in testTypeOptions" :key="option" :value="option">{{ option }}</option>
      </select>
      <select v-model="filterStatus" class="search-input" id="task-list-filter-status">
        <option value="">全部状态</option>
        <option v-for="option in statusOptions" :key="option" :value="option">{{ option }}</option>
      </select>
      <AppPagination
        v-if="pageCount > 1"
        :current-page="currentPage"
        :page-count="pageCount"
        @change="setCurrentPage"
      />
    </div>
    <table class="table" id="task-table">
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort @click="toggleSort('code')">任务编号</th>
          <th data-sort @click="toggleSort('source')">来源</th>
          <th data-sort @click="toggleSort('sampleCount')">样品</th>
          <th data-sort @click="toggleSort('testType')">实验摘要</th>
          <th data-sort @click="toggleSort('dueAt')">期望完成</th>
          <th data-sort @click="toggleSort('displayStatus')">状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="task-table-body">
        <tr v-for="(row, index) in taskRows" :key="row.id">
          <td>{{ (currentPage - 1) * 8 + index + 1 }}</td>
          <td>{{ row.code }}</td>
          <td>{{ row.source }}</td>
          <td>{{ row.sampleCount }}</td>
          <td>{{ row.testType }}</td>
          <td>{{ row.dueAt }}</td>
          <td><span :class="row.statusClass">{{ row.displayStatus }}</span></td>
          <td>
            <button class="action-link" :data-testid="`open-task-drawer-${index}`" type="button" @click="openTaskDrawer(row)">
              编辑
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <AppModal :open="intakeModalOpen" title="手动添加任务" @close="closeIntakeModal">
    <form class="tasks-intake-form">
      <div class="form-grid">
        <div class="form-field">
          <label>任务来源</label>
          <select v-model="intakeForm.source" name="source">
            <option>外部委托</option>
            <option>内部新增</option>
          </select>
        </div>
        <div class="form-field">
          <label>任务名称</label>
          <input v-model="intakeForm.name" type="text" name="name" placeholder="例如：来料检测-批次A" />
        </div>
        <div class="form-field">
          <label>任务编号</label>
          <input v-model="intakeForm.code" type="text" name="code" placeholder="根据试验类型自动生成" readonly />
        </div>
        <div class="form-field">
          <label>委托单位/部门</label>
          <input v-model="intakeForm.client" type="text" name="client" placeholder="客户或内部部门" />
        </div>
        <div class="form-field">
          <label>联系人</label>
          <input v-model="intakeForm.contact" type="text" name="contact" placeholder="姓名" />
        </div>
        <div class="form-field">
          <label>联系方式</label>
          <input v-model="intakeForm.contact_info" type="text" name="contact_info" placeholder="电话/邮箱" />
        </div>
        <div class="form-field">
          <label>优先级</label>
          <select v-model="intakeForm.priority" name="priority">
            <option>高</option>
            <option>中</option>
            <option>低</option>
          </select>
        </div>
        <div class="form-field">
          <label>样品数量</label>
          <input v-model="intakeForm.sample_count" type="number" name="sample_count" placeholder="例如：12" />
        </div>
        <div class="form-field">
          <label>样品类型</label>
          <input v-model="intakeForm.sample_type" type="text" name="sample_type" placeholder="例如：固体/液体/粉末" />
        </div>
        <div class="form-field">
          <label>试验类型</label>
          <select v-model="intakeForm.test_type" name="test_type">
            <option value="">请选择试验类型</option>
            <option v-for="option in testTypeOptions" :key="option" :value="option">{{ option }}</option>
          </select>
        </div>
        <div class="form-field">
          <label>期望完成时间</label>
          <input v-model="intakeForm.due_at" type="datetime-local" name="due_at" />
        </div>
        <div class="form-field">
          <label>到样时间</label>
          <input v-model="intakeForm.arrival_at" type="datetime-local" name="arrival_at" placeholder="确认入库后自动回写" step="1" readonly />
          <div class="helper">以样品管理确认入库时间为准，未确认前为空</div>
        </div>
        <div class="form-field">
          <label>环境/特殊条件</label>
          <input v-model="intakeForm.conditions" type="text" name="conditions" placeholder="温湿度/避光等" />
        </div>
        <div class="form-field">
          <label>附件</label>
          <input v-model="intakeForm.attachment" type="text" name="attachment" placeholder="上传报告或规范编号" />
          <div class="helper">可关联委托书、规范、SOP</div>
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>备注</label>
          <textarea v-model="intakeForm.remark" name="remark" placeholder="补充说明与注意事项"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button class="action-btn" data-testid="task-submit" type="button" @click="submitTask">提交受理</button>
        <button class="action-btn secondary" data-testid="task-draft" type="button" @click="saveDraft">保存草稿</button>
      </div>
      <div class="form-alert" :class="{ 'is-hidden': !intakeWarning }" data-task-warning>{{ intakeWarning }}</div>
    </form>
  </AppModal>

  <AppDrawer :open="taskDrawerOpen" title="任务详情" @close="closeTaskDrawer">
    <form class="form-grid tasks-edit-form">
      <div class="form-field">
        <label>任务编号</label>
        <input v-model="editForm.code" type="text" name="code" readonly />
      </div>
      <div class="form-field">
        <label>任务名称</label>
        <input v-model="editForm.name" type="text" name="name" placeholder="例如：来料检测-批次A" />
      </div>
      <div class="form-field">
        <label>来源</label>
        <select v-model="editForm.source" name="source">
          <option>外部委托</option>
          <option>内部新增</option>
        </select>
      </div>
      <div class="form-field">
        <label>优先级</label>
        <select v-model="editForm.priority" name="priority">
          <option>高</option>
          <option>中</option>
          <option>低</option>
        </select>
      </div>
      <div class="form-field">
        <label>样品数量</label>
        <input v-model="editForm.sample_count" type="number" name="sample_count" placeholder="例如：12" />
      </div>
      <div class="form-field">
        <label>样品类型</label>
        <input v-model="editForm.sample_type" type="text" name="sample_type" placeholder="例如：固体/液体/粉末" />
      </div>
      <div class="form-field">
        <label>试验类型</label>
        <select v-model="editForm.test_type" name="test_type">
          <option value="">请选择试验类型</option>
          <option v-for="option in testTypeOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </div>
      <div class="form-field">
        <label>期望完成时间</label>
        <input v-model="editForm.due_at" type="datetime-local" name="due_at" />
      </div>
      <div class="form-field">
        <label>到样时间</label>
        <input v-model="editForm.arrival_at" type="datetime-local" name="arrival_at" placeholder="确认入库后自动回写" step="1" readonly />
        <div class="helper">以样品管理确认入库时间为准，重新入库会覆盖</div>
      </div>
      <div class="form-field">
        <label>状态</label>
        <select v-model="editForm.status" name="status">
          <option>待排程</option>
          <option>已排程</option>
          <option>实验中</option>
          <option>实验已经完成</option>
          <option>厂家收回</option>
        </select>
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>备注</label>
        <textarea v-model="editForm.remark" name="remark" placeholder="更新说明"></textarea>
      </div>
    </form>
    <div class="form-actions">
      <button class="action-btn" data-testid="task-update" type="button" @click="updateTask">保存修改</button>
      <button class="action-btn secondary" data-testid="task-delete" type="button" @click="deleteTask">删除任务</button>
    </div>
    <div class="form-alert" :class="{ 'is-hidden': !editWarning }" data-task-edit-warning>{{ editWarning }}</div>
  </AppDrawer>
  </div>
</template>

<script setup>
import AppDrawer from "@/components/shared/AppDrawer.vue";
import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import { useTasksPage } from "./useTasksPage";

const {
  closeIntakeModal,
  closeTaskDrawer,
  currentPage,
  deleteTask,
  editForm,
  editWarning,
  filterStatus,
  filterTestType,
  intakeForm,
  intakeModalOpen,
  intakeWarning,
  metrics,
  pageCount,
  query,
  saveDraft,
  setCurrentPage,
  statusOptions,
  submitTask,
  taskDrawerOpen,
  taskRows,
  testTypeOptions,
  toggleSort,
  updateTask,
  openTaskDrawer,
} = useTasksPage();
</script>
