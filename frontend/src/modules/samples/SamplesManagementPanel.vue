<template>
  <div class="samples-management-panel" :class="{ 'is-hidden': hidden }" data-testid="samples-management-panel">
    <div class="samples-submode-strip section">
      <button
        class="samples-submode-card is-content-centered"
        :class="{ active: activeSamplesTab === 'sample-flow' }"
        data-testid="samples-tab-flow"
        type="button"
        @click="setActiveSamplesTab('sample-flow')"
      >
        <strong>样品流转</strong>
      </button>
      <button
        class="samples-submode-card is-content-centered"
        :class="{ active: activeSamplesTab === 'sample-staging' }"
        data-testid="samples-tab-staging"
        type="button"
        @click="setActiveSamplesTab('sample-staging')"
      >
        <strong>暂存间</strong>
      </button>
    </div>

    <section class="card section" :class="{ 'is-hidden': activeSamplesTab !== 'sample-flow' }" data-testid="samples-flow-panel">
      <h3>样品流转与状态</h3>
      <div class="toolbar">
        <input
          class="search-input"
          data-testid="samples-flow-search"
          :value="samplesFlow.query"
          placeholder="筛选任务/样品/位置/状态"
          @input="samplesFlow.setQuery($event.target.value)"
        />
        <select
          class="search-input"
          data-testid="samples-flow-task-filter"
          :value="samplesFlow.selectedTaskCode"
          @change="samplesFlow.setTaskFilter($event.target.value)"
        >
          <option value="">全部任务</option>
          <option v-for="taskCode in samplesFlow.taskOptions" :key="taskCode" :value="taskCode">
            {{ taskCode }}
          </option>
        </select>
        <select
          class="search-input"
          data-testid="samples-flow-status-filter"
          :value="samplesFlow.selectedStatus"
          @change="samplesFlow.setStatusFilter($event.target.value)"
        >
          <option value="">全部状态</option>
          <option v-for="status in samplesFlow.statusOptions" :key="status" :value="status">
            {{ status }}
          </option>
        </select>
        <AppPagination :current-page="samplesFlow.currentPage" :page-count="samplesFlow.pageCount" @change="samplesFlow.setPage" />
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>序号</th>
            <th
              data-sort
              data-testid="samples-flow-sort-task"
              :data-sort-dir="samplesFlow.sortKey === 'task_code' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('task_code')"
            >
              任务
            </th>
            <th
              data-sort
              data-testid="samples-flow-sort-code"
              :data-sort-dir="samplesFlow.sortKey === 'code' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('code')"
            >
              样品编号
            </th>
            <th
              data-sort
              data-testid="samples-flow-sort-tray"
              :data-sort-dir="samplesFlow.sortKey === 'trayCodesText' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('trayCodesText')"
            >
              托盘编号
            </th>
            <th
              data-sort
              data-testid="samples-flow-sort-location"
              :data-sort-dir="samplesFlow.sortKey === 'location' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('location')"
            >
              当前位置
            </th>
            <th
              data-sort
              data-testid="samples-flow-sort-status"
              :data-sort-dir="samplesFlow.sortKey === 'status' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('status')"
            >
              状态
            </th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="samplesFlow.rows.length === 0">
            <td colspan="7" class="muted">暂无样品数据</td>
          </tr>
          <tr v-for="(row, index) in samplesFlow.rows" :key="row.id || row.code">
            <td>{{ (samplesFlow.currentPage - 1) * 8 + index + 1 }}</td>
            <td>{{ row.task_code || "-" }}</td>
            <td>{{ row.code || "-" }}</td>
            <td class="sample-flow-tray-code">{{ row.trayCodesText || "-" }}</td>
            <td>{{ row.location || "-" }}</td>
            <td><span :class="row.statusClass">{{ row.status || "-" }}</span></td>
            <td>
              <button
                class="action-btn secondary"
                type="button"
                :data-testid="`samples-flow-detail-${index}`"
                @click="samplesFlow.openSampleDetail(row.id || row.code)"
              >
                详情
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <AppFeedback :message="samplesFlow.warning" tone="warning" @close="samplesFlow.clearWarning" />
    </section>

    <section class="card section" :class="{ 'is-hidden': activeSamplesTab !== 'sample-staging' }" data-testid="samples-staging-panel">
      <h3>暂存间样品</h3>
      <div class="toolbar">
        <div class="muted" data-testid="samples-staging-count">当前暂存样品 {{ samplesFlow.stagingCount }}</div>
        <input
          :value="samplesFlow.stagingQuery"
          class="search-input"
          data-testid="samples-staging-search"
          placeholder="筛选任务/样品/位置/状态"
          @input="samplesFlow.setStagingQuery($event.target.value)"
        />
        <select
          class="search-input"
          data-testid="samples-staging-task-filter"
          :value="samplesFlow.stagingSelectedTaskCode"
          @change="samplesFlow.setStagingTaskFilter($event.target.value)"
        >
          <option value="">全部任务</option>
          <option v-for="taskCode in samplesFlow.stagingTaskOptions" :key="taskCode" :value="taskCode">
            {{ taskCode }}
          </option>
        </select>
        <select
          class="search-input"
          data-testid="samples-staging-status-filter"
          :value="samplesFlow.stagingSelectedStatus"
          @change="samplesFlow.setStagingStatusFilter($event.target.value)"
        >
          <option value="">全部状态</option>
          <option v-for="status in samplesFlow.stagingStatusOptions" :key="status" :value="status">
            {{ status }}
          </option>
        </select>
        <AppPagination :current-page="samplesFlow.stagingCurrentPage" :page-count="samplesFlow.stagingPageCount" @change="samplesFlow.setStagingPage" />
      </div>
      <table class="table" data-testid="samples-staging-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>任务</th>
            <th>样品编号</th>
            <th>托盘编号</th>
            <th>当前位置</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="samplesFlow.stagingRows.length === 0">
            <td colspan="7" class="muted">暂无暂存间样品</td>
          </tr>
          <tr v-for="(row, index) in samplesFlow.stagingRows" :key="row.id || row.code">
            <td>{{ (samplesFlow.stagingCurrentPage - 1) * 8 + index + 1 }}</td>
            <td>{{ row.task_code || "-" }}</td>
            <td>{{ row.code || "-" }}</td>
            <td class="sample-flow-tray-code">{{ row.trayCodesText || "-" }}</td>
            <td>{{ row.location || "-" }}</td>
            <td><span :class="row.statusClass">{{ row.status || "-" }}</span></td>
            <td>
              <button
                class="action-btn secondary"
                type="button"
                :data-testid="`samples-staging-detail-${index}`"
                @click="samplesFlow.openSampleDetail(row.id || row.code)"
              >
                详情
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <AppFeedback :message="samplesFlow.warning" tone="warning" @close="samplesFlow.clearWarning" />
    </section>

    <AppModal
      :open="samplesFlow.detailDrawerOpen"
      class="sample-detail-flow-modal"
      title="样品流程图"
      @close="samplesFlow.closeSampleDetail"
    >
      <div class="sample-detail-flow-head">
        <div>
          <span class="sample-detail-flow-label">样品编号</span>
          <strong data-testid="samples-flow-detail-code">{{ samplesFlow.detailForm.code || "-" }}</strong>
        </div>
        <div>
          <span class="sample-detail-flow-label">托盘编号</span>
          <strong data-testid="samples-flow-detail-tray-code">{{ samplesFlow.detailSampleTrayCode || "-" }}</strong>
        </div>
      </div>
      <section class="sample-flow-card sample-detail-flow-card">
        <div class="sample-flow-title">统一托盘流程图</div>
        <div class="sample-flow-status" data-testid="samples-flow-detail-flow-status">
          {{ samplesFlow.detailSampleTrayFlow?.currentStatus || "当前样品未绑定托盘" }}
        </div>
        <ol v-if="samplesFlow.detailSampleTrayFlow?.steps?.length" class="sample-flow-unified sample-flow-unified--timed">
          <li
            v-for="(step, index) in samplesFlow.detailSampleTrayFlow?.steps || []"
            :key="step.key"
            :data-flow-step="index"
            :data-testid="`samples-flow-detail-flow-step-${step.key}`"
            :class="{ current: step.active, reached: step.reached }"
          >
            <span class="sample-flow-label">{{ step.label }}</span>
            <span class="sample-flow-time">{{ formatFlowTime(step.time) }}</span>
          </li>
        </ol>
        <div v-else class="muted">当前样品未绑定托盘，暂无流程图。</div>
      </section>
      <AppFeedback :message="samplesFlow.warning" tone="warning" @close="samplesFlow.clearWarning" />
      <template #footer>
        <button class="action-btn secondary" type="button" @click="samplesFlow.closeSampleDetail">取消</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup>
import { useTabState } from "@/composables/useTabState";
import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";

defineProps({
  hidden: {
    type: Boolean,
    default: false,
  },
  samplesFlow: {
    type: Object,
    required: true,
  },
});

const formatFlowTime = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace("T", " ")
    .replace(/\.\d{1,6}/, "")
    .replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
};

const { activeTab: activeSamplesTab, setActiveTab: setActiveSamplesTab } = useTabState("sample-flow");
</script>
