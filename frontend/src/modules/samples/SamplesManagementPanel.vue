<template>
  <div class="samples-management-panel" :class="{ 'is-hidden': hidden }" data-testid="samples-management-panel">
    <SampleProcessPanel :samples-process="samplesProcess" />

    <div class="tabs section">
      <button
        class="tab-btn"
        :class="{ active: activeSamplesTab === 'sample-flow' }"
        data-testid="samples-tab-flow"
        type="button"
        @click="setActiveSamplesTab('sample-flow')"
      >
        样品流转
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeSamplesTab === 'sample-staging' }"
        data-testid="samples-tab-staging"
        type="button"
        @click="setActiveSamplesTab('sample-staging')"
      >
        暂存间
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
        <button class="action-btn" type="button" data-testid="samples-flow-open-batch" @click="samplesFlow.openBatchModal">
          批量入库
        </button>
        <AppPagination :current-page="samplesFlow.currentPage" :page-count="samplesFlow.pageCount" @change="samplesFlow.setPage" />
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>序号</th>
            <th
              data-testid="samples-flow-sort-task"
              :data-sort-dir="samplesFlow.sortKey === 'task_code' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('task_code')"
            >
              任务
            </th>
            <th
              data-testid="samples-flow-sort-code"
              :data-sort-dir="samplesFlow.sortKey === 'code' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('code')"
            >
              样品编号
            </th>
            <th
              data-testid="samples-flow-sort-tray"
              :data-sort-dir="samplesFlow.sortKey === 'trayCount' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('trayCount')"
            >
              托盘数
            </th>
            <th
              data-testid="samples-flow-sort-location"
              :data-sort-dir="samplesFlow.sortKey === 'location' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('location')"
            >
              当前位置
            </th>
            <th
              data-testid="samples-flow-sort-owner"
              :data-sort-dir="samplesFlow.sortKey === 'owner' ? samplesFlow.sortDirection : ''"
              @click="samplesFlow.toggleSamplesFlowSort('owner')"
            >
              责任人
            </th>
            <th
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
            <td colspan="8" class="muted">暂无样品数据</td>
          </tr>
          <tr v-for="(row, index) in samplesFlow.rows" :key="row.id || row.code">
            <td>{{ (samplesFlow.currentPage - 1) * 8 + index + 1 }}</td>
            <td>{{ row.task_code || "-" }}</td>
            <td>{{ row.code || "-" }}</td>
            <td>{{ row.trayCount }}</td>
            <td>{{ row.location || "-" }}</td>
            <td>{{ row.owner || "-" }}</td>
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
      <div class="form-alert" :class="{ 'is-hidden': !samplesFlow.warning }">{{ samplesFlow.warning }}</div>
    </section>

    <section class="card section" :class="{ 'is-hidden': activeSamplesTab !== 'sample-staging' }" data-testid="samples-staging-panel">
      <h3>暂存间派发</h3>
      <div class="toolbar">
        <div class="muted" data-testid="samples-staging-count">暂存间未试验样品 {{ samplesFlow.stagingCount }}</div>
        <input
          :value="samplesFlow.stagingQuery"
          class="search-input"
          data-testid="samples-staging-search"
          placeholder="筛选样品/任务/状态"
          @input="samplesFlow.setStagingQuery($event.target.value)"
        />
      </div>
      <table class="table" data-testid="samples-staging-table">
        <thead>
          <tr>
            <th style="width: 56px;">
              <input
                :checked="samplesFlow.stagingAllSelected"
                data-testid="samples-staging-select-all"
                type="checkbox"
                @change="samplesFlow.toggleAllStagingSelection($event.target.checked)"
              />
            </th>
            <th>序号</th>
            <th>样品编号</th>
            <th>任务</th>
            <th>当前位置</th>
            <th>状态</th>
            <th>责任人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="samplesFlow.stagingRows.length === 0">
            <td colspan="7" class="muted">暂无可派发样品</td>
          </tr>
          <tr v-for="(row, index) in samplesFlow.stagingRows" :key="row.id || row.code">
            <td>
              <input
                :checked="row.selected"
                :data-testid="`samples-staging-select-${index}`"
                type="checkbox"
                @change="samplesFlow.toggleStagingSelection(row.code, $event.target.checked)"
              />
            </td>
            <td>{{ index + 1 }}</td>
            <td>{{ row.code || "-" }}</td>
            <td>{{ row.task_code || "-" }}</td>
            <td>{{ row.location || "-" }}</td>
            <td><span :class="row.statusClass">{{ row.status || "-" }}</span></td>
            <td>{{ row.owner || "-" }}</td>
          </tr>
        </tbody>
      </table>
      <div class="form-grid section">
        <div class="form-field">
          <label>派发样品</label>
          <textarea
            v-model="samplesFlow.stagingForm.codes"
            data-testid="samples-staging-codes"
            placeholder="输入或扫描样品编号；也可直接勾选上方样品"
          ></textarea>
        </div>
        <div class="form-field">
          <label>目标实验室</label>
          <select v-model="samplesFlow.stagingForm.targetLab" data-testid="samples-staging-target-lab">
            <option value="">请选择实验室</option>
            <option v-for="lab in samplesFlow.stagingLabOptions" :key="lab" :value="lab">
              {{ lab }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label>责任人</label>
          <input v-model="samplesFlow.stagingForm.owner" data-testid="samples-staging-owner" type="text" placeholder="负责人姓名" />
        </div>
      </div>
      <div class="form-actions">
        <button class="action-btn" data-testid="samples-staging-submit" type="button" @click="samplesFlow.submitStagingDispatch">
          派发至实验室
        </button>
        <button class="action-btn secondary" data-testid="samples-staging-reset" type="button" @click="samplesFlow.resetStaging">
          清空输入
        </button>
      </div>
      <div class="form-alert" :class="{ 'is-hidden': !samplesFlow.warning }">{{ samplesFlow.warning }}</div>
    </section>

    <section class="card section">
      <h3>样品全生命周期追踪</h3>
      <form>
        <div class="form-grid">
          <div class="form-field">
            <label>试验序号</label>
            <input
              v-model="sampleTrace.form.task_code"
              data-testid="sample-trace-task-code"
              type="text"
              name="task_code"
              placeholder="例如：SZH-2024-003"
            />
          </div>
        </div>
        <div class="form-actions">
          <a class="action-btn" href="#" data-testid="sample-trace-run" @click.prevent="sampleTrace.runTrace">查询</a>
          <a class="action-btn secondary" href="#" data-testid="sample-trace-reset" @click.prevent="sampleTrace.resetTrace">清空</a>
        </div>
      </form>
      <div class="muted" data-testid="sample-trace-summary-text">{{ sampleTrace.summaryText }}</div>
      <div class="timeline" data-testid="sample-trace-timeline-list">
        <div v-for="item in sampleTrace.timelineItems" :key="item.id" class="timeline-item">
          <div class="timeline-dot"></div>
          <div>
            <div>{{ item.title }}</div>
            <div class="muted">{{ item.meta }}</div>
          </div>
        </div>
      </div>
    </section>

    <AppModal :open="samplesFlow.batchModalOpen" title="批量入库" @close="samplesFlow.closeBatchModal">
      <div class="form-grid">
        <div class="form-field">
          <label>入库位置</label>
          <select v-model="samplesFlow.batchForm.location" data-testid="samples-flow-batch-location">
            <option value="">请选择实验室</option>
            <option v-for="location in samplesFlow.locationOptions" :key="location" :value="location">
              {{ location }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label>责任人</label>
          <input v-model="samplesFlow.batchForm.owner" data-testid="samples-flow-batch-owner" type="text" placeholder="负责人姓名" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>样品列表</label>
          <textarea
            v-model="samplesFlow.batchForm.codes"
            data-testid="samples-flow-batch-codes"
            placeholder="输入或扫描多个样品编号"
          ></textarea>
        </div>
      </div>
      <div class="form-alert" :class="{ 'is-hidden': !samplesFlow.warning }">{{ samplesFlow.warning }}</div>
      <template #footer>
        <button class="action-btn" type="button" data-testid="samples-flow-batch-submit" @click="samplesFlow.submitSamplesFlowBatch">
          确认入库
        </button>
        <button class="action-btn secondary" type="button" @click="samplesFlow.closeBatchModal">取消</button>
      </template>
    </AppModal>

    <AppDrawer :open="samplesFlow.detailDrawerOpen" title="样品详情" @close="samplesFlow.closeSampleDetail">
      <div class="form-grid">
        <div class="form-field">
          <label>样品编号</label>
          <input :value="samplesFlow.detailForm.code" data-testid="samples-flow-detail-code" type="text" readonly />
        </div>
        <div class="form-field">
          <label>状态</label>
          <select v-model="samplesFlow.detailForm.status" data-testid="samples-flow-detail-status">
            <option v-for="status in samplesFlow.detailStatusOptions" :key="status" :value="status">
              {{ status }}
            </option>
          </select>
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>流转备注</label>
          <textarea
            v-model="samplesFlow.detailForm.remark"
            data-testid="samples-flow-detail-remark"
            placeholder="更新流转信息"
          ></textarea>
        </div>
      </div>
      <div class="form-alert" :class="{ 'is-hidden': !samplesFlow.warning }">{{ samplesFlow.warning }}</div>
      <template #footer>
        <button class="action-btn" type="button" data-testid="samples-flow-detail-save" @click="samplesFlow.saveSampleDetail">
          保存修改
        </button>
        <button class="action-btn secondary" type="button" @click="samplesFlow.closeSampleDetail">取消</button>
      </template>
    </AppDrawer>
  </div>
</template>

<script setup>
import { useTabState } from "@/composables/useTabState";
import AppDrawer from "@/components/shared/AppDrawer.vue";
import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import SampleProcessPanel from "./SampleProcessPanel.vue";

defineProps({
  hidden: {
    type: Boolean,
    default: false,
  },
  sampleTrace: {
    type: Object,
    required: true,
  },
  samplesFlow: {
    type: Object,
    required: true,
  },
  samplesProcess: {
    type: Object,
    required: true,
  },
});

const { activeTab: activeSamplesTab, setActiveTab: setActiveSamplesTab } = useTabState("sample-flow");
</script>
