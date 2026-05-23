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
      <div class="muted">需设备可用</div>
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
    <div v-if="loadError" class="form-alert" data-testid="task-load-error">{{ loadError }}</div>
    <AppFeedback :message="resetFeedback" tone="success" data-testid="task-reset-feedback" @close="resetFeedback = ''" />
    <table class="table tasks-table" id="task-table">
      <thead>
        <tr>
          <th class="tasks-table__col tasks-table__col--index">序号</th>
          <th class="tasks-table__col tasks-table__col--code" data-sort :data-sort-dir="sortKey === 'code' ? sortDirection : ''" @click="toggleSort('code')">任务编号</th>
          <th class="tasks-table__col tasks-table__col--source" data-sort :data-sort-dir="sortKey === 'source' ? sortDirection : ''" @click="toggleSort('source')">来源</th>
          <th class="tasks-table__col tasks-table__col--sample-count" data-sort :data-sort-dir="sortKey === 'sampleCount' ? sortDirection : ''" @click="toggleSort('sampleCount')">样品</th>
          <th class="tasks-table__col tasks-table__col--summary" data-sort :data-sort-dir="sortKey === 'testType' ? sortDirection : ''" @click="toggleSort('testType')">实验摘要</th>
          <th class="tasks-table__col tasks-table__col--due-at" data-sort :data-sort-dir="sortKey === 'dueAt' ? sortDirection : ''" @click="toggleSort('dueAt')">期望完成</th>
          <th class="tasks-table__col tasks-table__col--status" data-sort :data-sort-dir="sortKey === 'displayStatus' ? sortDirection : ''" @click="toggleSort('displayStatus')">状态</th>
          <th class="tasks-table__col tasks-table__col--actions">操作</th>
        </tr>
      </thead>
      <tbody id="task-table-body">
        <tr v-for="(row, index) in taskRows" :key="row.id">
          <td class="tasks-table__cell tasks-table__cell--index">{{ (currentPage - 1) * 8 + index + 1 }}</td>
          <td class="tasks-table__cell tasks-table__cell--code">{{ row.code }}</td>
          <td class="tasks-table__cell tasks-table__cell--source">{{ row.source }}</td>
          <td class="tasks-table__cell tasks-table__cell--sample-count">{{ row.sampleCount }}</td>
          <td class="tasks-table__cell tasks-table__cell--summary">
            <span class="tasks-table__summary-text">{{ row.testType }}</span>
          </td>
          <td class="tasks-table__cell tasks-table__cell--due-at">{{ row.dueAt }}</td>
          <td class="tasks-table__cell tasks-table__cell--status"><span :class="row.statusClass">{{ row.displayStatusLabel || row.displayStatus }}</span></td>
          <td class="tasks-table__cell tasks-table__cell--actions">
            <button class="action-link" :data-testid="`open-task-drawer-${index}`" type="button" @click="openTaskDrawer(row)">
              编辑
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <AppModal :open="intakeModalOpen" class="tasks-intake-modal" title="手动添加任务" @close="closeIntakeModal">
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
          <input v-model="intakeForm.name" type="text" name="name" maxlength="20" placeholder="例如：来料检测-批次A" />
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
          <input v-model="intakeForm.contact" type="text" name="contact" required placeholder="姓名" />
        </div>
        <div class="form-field">
          <label>联系方式</label>
          <input v-model="intakeForm.contact_info" type="text" name="contact_info" inputmode="numeric" maxlength="15" required placeholder="请输入 1-15 位数字" @input="sanitizeIntakeContactInfo" />
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
          <input v-model="intakeForm.sample_count" type="number" name="sample_count" min="1" max="999" step="1" required placeholder="例如：12" />
        </div>
        <div class="form-field tasks-sample-preview">
          <label>样品编号预览</label>
          <div class="tasks-sample-preview__list" data-testid="task-intake-sample-code-preview">
            <span v-for="code in intakeSampleCodePreview" :key="code">{{ code }}</span>
            <span v-if="intakeSampleCodePreview.length === 0" class="muted">选择试验类型并填写样品数量后生成</span>
          </div>
        </div>
        <div class="form-field">
          <label>样品类型</label>
          <input v-model="intakeForm.sample_type" type="text" name="sample_type" placeholder="例如：固体/液体/粉末" />
        </div>
        <div class="form-field">
          <label>试验类型</label>
          <div class="tasks-intake-test-types">
            <button
              class="search-input tasks-intake-test-types__trigger"
              data-testid="task-intake-test-types-trigger"
              type="button"
              @click="openIntakeExperimentPicker"
            >
              <span>{{ intakeExperimentSummary || "请选择试验类型" }}</span>
            </button>
          </div>
        </div>
        <div class="form-field">
          <label>期望完成时间</label>
          <PickerOnlyInput v-model="intakeForm.due_at" type="datetime-local" name="due_at" />
        </div>
        <div class="form-field">
          <label>到样时间</label>
          <PickerOnlyInput v-model="intakeForm.arrival_at" type="datetime-local" name="arrival_at" placeholder="确认入库后自动回写" step="1" readonly />
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
      <AppFeedback :message="intakeWarning" tone="warning" data-task-warning @close="intakeWarning = ''" />
    </form>
  </AppModal>

  <AppModal :open="intakeExperimentModalOpen" title="选择试验类型" @close="closeIntakeExperimentPicker">
    <div class="tasks-intake-picker-modal" data-testid="task-intake-test-types-modal">
      <div class="tasks-intake-picker-modal__summary" data-testid="task-intake-test-types-summary">
        {{ intakeExperimentDraftSummary || "请选择试验类型" }}
      </div>

      <div
        class="tasks-intake-test-types__grid"
        data-testid="task-intake-test-types-grid"
      >
        <button
          v-for="option in intakeExperimentTypeOptions"
          :key="option"
          class="tasks-intake-test-types__card"
          :class="{ 'is-selected': intakeExperimentDraft.includes(option) }"
          :data-testid="`task-intake-test-type-option-${option}`"
          type="button"
          @click="toggleIntakeExperimentType(option)"
        >
          <span class="tasks-intake-test-types__card-name">{{ option }}</span>
          <span class="tasks-intake-test-types__card-tail">
            <span
              class="tasks-intake-test-types__check"
              :class="{ 'is-selected': intakeExperimentDraft.includes(option) }"
              :data-testid="`task-intake-test-type-check-${option}`"
            >
              {{ intakeExperimentDraft.includes(option) ? "✓" : "" }}
            </span>
          </span>
        </button>
      </div>
    </div>
    <template #footer>
      <button class="action-btn secondary" data-testid="task-intake-test-types-cancel" type="button" @click="closeIntakeExperimentPicker">
        取消
      </button>
      <button class="action-btn" data-testid="task-intake-test-types-confirm" type="button" @click="confirmIntakeExperimentPicker">
        确认选择
      </button>
    </template>
  </AppModal>

  <AppModal :open="resetModalOpen" title="确认任务重置" @close="closeResetModal">
    <div v-if="resetModalOpen" data-testid="task-reset-modal">
      <p>确认后将清空当前数据库中的所有任务相关数据，并重建为新的演示基线。</p>
      <p>重置后所有任务都会回到待排程，所有样品都会回到运输中。</p>
      <AppFeedback :message="resetError" tone="error" @close="resetError = ''" />
    </div>
    <template #footer>
      <button class="action-btn danger" data-testid="task-reset-confirm" type="button" :disabled="resetting" @click="resetTasks">
        确认重置
      </button>
      <button class="action-btn secondary" data-testid="task-reset-cancel" type="button" :disabled="resetting" @click="closeResetModal">
        取消
      </button>
    </template>
  </AppModal>

  <AppModal
    :open="taskDrawerOpen"
    class="tasks-task-detail-modal"
    data-testid="task-detail-modal"
    title="任务详情"
    @close="closeTaskDrawer"
  >
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
        <input v-model="editForm.sample_count" type="number" name="sample_count" min="1" max="999" step="1" required placeholder="例如：12" />
      </div>
      <div class="form-field tasks-sample-preview">
        <label>样品编号</label>
        <div class="tasks-sample-preview__header">
          <span class="muted">
            共 {{ taskDetailSampleCodes.length }} 个<span v-if="taskDetailSampleCodes.length > taskDetailSampleCodePreview.length">，显示前 5 个</span>
          </span>
          <button class="action-link" data-testid="open-sample-codes-editor" type="button" @click="openSampleCodesEditor">
            编辑样品编号
          </button>
        </div>
        <div class="tasks-sample-preview__list" data-testid="task-detail-sample-code-preview">
          <span v-for="code in taskDetailSampleCodePreview" :key="code">{{ code }}</span>
          <span v-if="taskDetailSampleCodePreview.length === 0" class="muted">暂无样品编号</span>
        </div>
      </div>
      <div class="form-field">
        <label>样品类型</label>
        <input v-model="editForm.sample_type" type="text" name="sample_type" placeholder="例如：固体/液体/粉末" />
      </div>
      <div class="form-field">
        <label>试验类型</label>
        <div class="tasks-intake-test-types">
          <button
            class="search-input tasks-intake-test-types__trigger"
            data-testid="task-edit-test-types-trigger"
            type="button"
            @click="openEditExperimentPicker"
          >
            <span>{{ editExperimentSummary || "请选择试验类型" }}</span>
          </button>
        </div>
      </div>
      <div class="form-field">
        <label>期望完成时间</label>
        <PickerOnlyInput v-model="editForm.due_at" type="datetime-local" name="due_at" />
      </div>
      <div class="form-field">
        <label>到样时间</label>
        <PickerOnlyInput v-model="editForm.arrival_at" type="datetime-local" name="arrival_at" placeholder="确认入库后自动回写" step="1" readonly />
        <div class="helper">以样品管理确认入库时间为准，重新入库会覆盖</div>
      </div>
      <div class="form-field">
        <label>状态</label>
        <input :value="editForm.status || '-'" data-testid="task-edit-status-readonly" name="status" type="text" readonly />
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
    <AppFeedback :message="editWarning" tone="warning" data-task-edit-warning @close="editWarning = ''" />
  </AppModal>

  <AppModal
    :open="sampleCodesModalOpen"
    class="tasks-sample-codes-modal"
    data-testid="task-sample-codes-modal"
    title="编辑样品编号"
    @close="closeSampleCodesEditor"
  >
    <div class="tasks-sample-codes-editor">
      <div class="form-field">
        <label>样品编号（换行、逗号或分号分隔）</label>
        <textarea
          v-model="sampleCodesDraft"
          class="tasks-sample-codes-editor__textarea"
          data-testid="task-sample-codes-textarea"
          placeholder="每行一个样品编号"
        ></textarea>
      </div>
      <AppFeedback :message="sampleCodesWarning" tone="warning" @close="sampleCodesWarning = ''" />
    </div>
    <template #footer>
      <button class="action-btn secondary" type="button" @click="closeSampleCodesEditor">取消</button>
      <button class="action-btn" data-testid="task-sample-codes-confirm" type="button" @click="saveSampleCodes">
        保存样品编号
      </button>
    </template>
  </AppModal>

  <AppModal :open="editExperimentModalOpen" title="选择试验类型" @close="closeEditExperimentPicker">
    <div class="tasks-intake-picker-modal" data-testid="task-edit-test-types-modal">
      <div class="tasks-intake-picker-modal__summary" data-testid="task-edit-test-types-summary">
        {{ editExperimentDraftSummary || "请选择试验类型" }}
      </div>

      <div
        class="tasks-intake-test-types__grid"
        data-testid="task-edit-test-types-grid"
      >
        <button
          v-for="option in editExperimentTypeOptions"
          :key="option"
          class="tasks-intake-test-types__card"
          :class="{ 'is-selected': editExperimentDraft.includes(option) }"
          :data-testid="`task-edit-test-type-option-${option}`"
          type="button"
          @click="toggleEditExperimentType(option)"
        >
          <span class="tasks-intake-test-types__card-name">{{ option }}</span>
          <span class="tasks-intake-test-types__card-tail">
            <span
              class="tasks-intake-test-types__check"
              :class="{ 'is-selected': editExperimentDraft.includes(option) }"
              :data-testid="`task-edit-test-type-check-${option}`"
            >
              {{ editExperimentDraft.includes(option) ? "✓" : "" }}
            </span>
          </span>
        </button>
      </div>
    </div>
    <template #footer>
      <button class="action-btn secondary" data-testid="task-edit-test-types-cancel" type="button" @click="closeEditExperimentPicker">
        取消
      </button>
      <button class="action-btn" data-testid="task-edit-test-types-confirm" type="button" @click="confirmEditExperimentPicker">
        确认选择
      </button>
    </template>
  </AppModal>

  <AppModal :open="scheduledExperimentRemovalModalOpen" title="确认修改实验类型" @close="closeScheduledExperimentRemovalConfirm">
    <div class="tasks-danger-confirmation" data-testid="task-scheduled-removal-confirm">
      <strong>实验类型已变更</strong>
      <p>确定修改后将同步删除该任务原有排程信息，并清空预接驳托盘分配，需要重新排程并从预接驳处重新分配托盘。</p>
    </div>
    <template #footer>
      <button class="action-btn secondary" data-testid="task-scheduled-removal-confirm-cancel" type="button" @click="closeScheduledExperimentRemovalConfirm">
        取消
      </button>
      <button class="action-btn danger" data-testid="task-scheduled-removal-confirm-ok" type="button" @click="confirmScheduledExperimentRemoval">
        确定修改
      </button>
    </template>
  </AppModal>
  </div>
</template>

<script setup>
defineOptions({
  name: "TasksPage",
});

import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";
import { useTasksPage } from "./useTasksPage";

const {
  closeIntakeModal,
  closeTaskDrawer,
  closeScheduledExperimentRemovalConfirm,
  currentPage,
  deleteTask,
  closeEditExperimentPicker,
  closeSampleCodesEditor,
  confirmEditExperimentPicker,
  confirmScheduledExperimentRemoval,
  editExperimentDraft,
  editExperimentDraftSummary,
  editExperimentModalOpen,
  editExperimentSummary,
  editExperimentTypeOptions,
  editForm,
  editWarning,
  filterStatus,
  filterTestType,
  intakeForm,
  intakeExperimentDraft,
  intakeExperimentDraftSummary,
  intakeExperimentModalOpen,
  intakeExperimentSummary,
  intakeExperimentTypeOptions,
  intakeModalOpen,
  intakeSampleCodePreview,
  intakeWarning,
  loadError,
  metrics,
  pageCount,
  query,
  closeResetModal,
  resetError,
  resetFeedback,
  resetModalOpen,
  resetTasks,
  resetting,
  scheduledExperimentRemovalModalOpen,
  sampleCodesDraft,
  sampleCodesModalOpen,
  sampleCodesWarning,
  saveDraft,
  saveSampleCodes,
  setCurrentPage,
  statusOptions,
  closeIntakeExperimentPicker,
  confirmIntakeExperimentPicker,
  openEditExperimentPicker,
  openIntakeExperimentPicker,
  openSampleCodesEditor,
  sortDirection,
  sortKey,
  submitTask,
  taskDrawerOpen,
  taskDetailSampleCodePreview,
  taskDetailSampleCodes,
  taskRows,
  testTypeOptions,
  toggleIntakeExperimentType,
  toggleEditExperimentType,
  toggleSort,
  updateTask,
  openTaskDrawer,
} = useTasksPage();
</script>

<style scoped>
.tasks-intake-test-types__trigger {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 44px;
  width: 100%;
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(248, 250, 252, 0.95);
  border: 1px solid rgba(15, 23, 42, 0.16);
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}

.tasks-intake-picker-modal {
  display: grid;
  gap: 16px;
}

.tasks-intake-picker-modal__summary {
  border-radius: 10px;
  padding: 12px;
  background: rgba(248, 250, 252, 0.95);
  border: 1px solid rgba(15, 23, 42, 0.16);
  color: #0f172a;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.45;
}

.tasks-intake-test-types__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.tasks-intake-test-types__card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.16);
  background: rgba(248, 250, 252, 0.95);
  color: #0f172a;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.tasks-intake-test-types__card:hover {
  border-color: rgba(56, 189, 248, 0.35);
  box-shadow: 0 8px 16px rgba(15, 23, 42, 0.06);
}

.tasks-intake-test-types__card.is-selected {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.12);
  box-shadow: none;
}

.tasks-intake-test-types__card-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
}

.tasks-intake-test-types__card-tail {
  display: flex;
  align-items: center;
  flex: none;
}

.tasks-intake-test-types__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.24);
  background: rgba(255, 255, 255, 0.98);
  color: transparent;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.tasks-intake-test-types__check.is-selected {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.18);
  color: #0f172a;
}

.tasks-danger-confirmation {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(244, 63, 94, 0.35);
  border-radius: 10px;
  padding: 14px;
  background: rgba(255, 241, 242, 0.96);
  color: #b91c1c;
}

.tasks-danger-confirmation strong,
.tasks-danger-confirmation p {
  margin: 0;
}

.tasks-danger-confirmation strong {
  font-size: 15px;
}

.tasks-danger-confirmation p {
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 820px) {
  .tasks-intake-test-types__grid {
    grid-template-columns: 1fr;
  }

  .tasks-intake-picker-modal__summary {
    font-size: 15px;
  }

  .tasks-intake-test-types__card-name {
    font-size: 14px;
  }
}
</style>
