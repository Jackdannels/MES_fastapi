<template>
  <section class="card section">
    <h3>样品登记</h3>
    <form>
      <div class="form-grid">
        <div class="form-field">
          <label>样品编号</label>
          <input
            v-model="sampleIntakeForm.code"
            data-testid="sample-intake-code"
            type="text"
            name="code"
            readonly
            placeholder="选择关联任务后自动生成样品编号"
          />
          <div class="helper">按任务号自动生成并绑定，例如：SZH-2024-003-SP-001</div>
        </div>
        <div class="form-field">
          <label>关联任务</label>
          <select
            :value="sampleIntakeForm.task_code"
            data-testid="sample-intake-task"
            name="task_code"
            data-placeholder="请选择任务"
            data-empty-placeholder="暂无任务"
            @change="setSampleIntakeTaskCode($event.target.value)"
          >
            <option value="">{{ sampleIntakeTaskOptions.length ? "请选择任务" : "暂无任务" }}</option>
            <option v-for="option in sampleIntakeTaskOptions" :key="option.code" :value="option.code">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label>样品类型</label>
          <input v-model="sampleIntakeForm.sample_type" type="text" name="sample_type" placeholder="固体/液体/粉末" />
        </div>
        <div class="form-field">
          <label>批次/批号</label>
          <input v-model="sampleIntakeForm.batch_no" type="text" name="batch_no" placeholder="批次号" />
        </div>
        <div class="form-field">
          <label>到样时间</label>
          <input v-model="sampleIntakeForm.arrival_at" type="datetime-local" name="arrival_at" />
        </div>
        <div class="form-field">
          <label>数量</label>
          <input v-model="sampleIntakeForm.quantity" type="number" name="quantity" placeholder="例如：12" />
        </div>
        <div class="form-field">
          <label>保存条件</label>
          <input v-model="sampleIntakeForm.storage_condition" type="text" name="storage_condition" placeholder="常温/冷藏/避光" />
        </div>
        <div class="form-field">
          <label>标签/条码</label>
          <input v-model="sampleIntakeForm.barcode" type="text" name="barcode" placeholder="扫描或输入条码" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>备注</label>
          <textarea v-model="sampleIntakeForm.remark" name="remark" placeholder="样品状态与特殊说明"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#" data-testid="sample-intake-submit" @click.prevent="submitSampleIntake">确认登记</a>
        <a class="action-btn secondary" href="#" data-testid="sample-intake-draft" @click.prevent="saveSampleIntakeDraft">保存草稿</a>
      </div>
      <div class="form-alert" :class="{ 'is-hidden': !sampleIntakeWarning }" data-sample-warning>{{ sampleIntakeWarning }}</div>
    </form>
  </section>

  <section class="card section">
    <h3>样品流程管理</h3>
    <div class="sample-process-layout">
      <div>
        <div class="form-grid sample-task-process-grid">
          <div class="form-field sample-task-focus-field">
            <label>选择任务</label>
            <select
              class="sample-task-focus-select"
              data-testid="samples-process-task-select"
              :value="selectedTaskCode"
              @change="selectTask($event.target.value)"
            >
              <option value="">{{ taskOptions.length ? "请选择任务" : "暂无任务" }}</option>
              <option v-for="option in taskOptions" :key="option.code" :value="option.code">
                {{ option.label }}
              </option>
            </select>
            <div class="helper sample-task-focus-hint">请选择任务后，自动加载样品数量、编号与托盘分配信息。</div>
          </div>
          <div class="form-field sample-task-count-field">
            <label>样品数量</label>
            <div class="kpi" data-testid="samples-process-count">{{ trayDraft.sampleCount || 0 }}</div>
            <div class="helper">
              {{ selectedTaskCode ? "已根据当前任务加载计划样品数量与托盘信息。" : "请选择任务后查看样品数量与样品编号。" }}
            </div>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>样品编号</label>
            <textarea
              class="sample-codes-input"
              data-testid="samples-process-codes"
              readonly
              :value="sampleCodesText"
              placeholder="选择任务后按任务号自动生成并绑定样品编号"
            ></textarea>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>样品分装</label>
            <div class="sample-tray-builder">
              <div class="sample-tray-source">
                <div class="sample-tray-title">可选样品</div>
                <div class="sample-tray-source-hint">
                  {{
                    activeTrayIndex >= 0 && trayDraft.trays[activeTrayIndex]
                      ? `当前托盘：${trayDraft.trays[activeTrayIndex].trayCode}`
                      : "当前未选中托盘"
                  }}
                </div>
                <div class="sample-tray-source-list">
                  <button
                    v-for="sampleCode in trayDraft.sampleCodes"
                    :key="sampleCode"
                    type="button"
                    class="sample-tray-chip"
                    draggable="true"
                    @dragstart="startDragging(sampleCode)"
                    @click="moveToActiveTray(sampleCode)"
                  >
                    {{ sampleCode }}
                  </button>
                </div>
              </div>
              <div class="sample-tray-main">
                <div class="sample-tray-toolbar">
                  <div class="sample-tray-title">托盘分装</div>
                  <label class="sample-tray-limit">
                    <span>统一上限（每托盘最多样品数）</span>
                    <input
                      data-testid="samples-process-tray-limit"
                      type="number"
                      min="1"
                      step="1"
                      :value="trayDraft.maxPerTray"
                      :disabled="storeLocked"
                      @change="setTrayLimit($event.target.value)"
                    />
                  </label>
                  <button
                    class="action-btn secondary sample-tray-add-btn"
                    type="button"
                    data-testid="samples-process-add-tray"
                    :disabled="!selectedTaskCode || storeLocked"
                    @click="addTray"
                  >
                    新增托盘
                  </button>
                </div>
                <div class="sample-tray-list">
                  <div
                    v-for="(tray, index) in trayDraft.trays"
                    :key="tray.id || tray.trayCode || index"
                    class="sample-tray-card"
                    :class="{ 'is-active': index === activeTrayIndex }"
                    :data-testid="`samples-process-tray-${index}`"
                    @click="setActiveTray(index)"
                    @dragover.prevent
                    @drop.prevent="handleTrayDrop(index)"
                  >
                    <div class="sample-tray-card-head">
                      <span>{{ tray.trayCode || `托盘 #${index + 1}` }}</span>
                      <span>{{ `托盘 #${index + 1}` }}</span>
                    </div>
                    <div class="sample-tray-card-meta">已放置 {{ tray.samples.length }} / {{ trayDraft.maxPerTray }}</div>
                    <div class="sample-tray-samples">
                      <span v-if="tray.samples.length === 0" class="sample-tray-empty">未分配样品</span>
                      <button
                        v-for="sampleCode in tray.samples"
                        :key="sampleCode"
                        type="button"
                        class="sample-tray-sample-tag"
                        draggable="true"
                        @dragstart.stop="startDragging(sampleCode)"
                      >
                        {{ sampleCode }}
                      </button>
                    </div>
                    <div class="sample-tray-card-controls">
                      <label class="sample-tray-capacity">数量（当前放置样品数）：{{ tray.samples.length }}</label>
                      <button
                        type="button"
                        class="sample-tray-remove"
                        :data-testid="`samples-process-delete-tray-${index}`"
                        :disabled="trayDraft.trays.length <= 1 || storeLocked"
                        @click.stop="removeTray(index)"
                      >
                        删除托盘
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="helper">
              默认统一上限 5、默认 2 个托盘；按样品编号顺序连续分配（如 1-4、5-8），支持托盘间拖拽。
            </div>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>托盘编号预览</label>
            <textarea
              class="sample-codes-input"
              data-testid="samples-process-tray-preview"
              readonly
              :value="trayPreviewText"
              placeholder="完成分装后将显示托盘编号与托盘数量"
            ></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button
            class="action-btn"
            type="button"
            data-testid="samples-process-store"
            :disabled="storeLocked"
            @click="confirmStore"
          >
            确认入库
          </button>
          <button
            class="action-btn secondary"
            type="button"
            data-testid="samples-process-print"
            :disabled="!canPrint"
            @click="printTrays"
          >
            编码打印
          </button>
          <button
            class="action-btn secondary"
            type="button"
            data-testid="samples-process-restore"
            :disabled="!storeLocked"
            @click="restoreStore"
          >
            重新入库
          </button>
        </div>
        <div class="form-alert" :class="{ 'is-hidden': !warning }">{{ warning }}</div>
      </div>
      <div class="sample-flow-card">
        <div class="sample-flow-title">统一样品流程图</div>
        <div class="sample-flow-status">{{ currentFlowStatus }}</div>
        <ol class="sample-flow-unified">
          <li
            v-for="(step, index) in flowSteps"
            :key="step.key"
            :data-flow-step="index"
            :data-testid="`sample-flow-step-${step.key}`"
            :class="{ current: step.active, reached: step.reached }"
          >
            {{ step.label }}
          </li>
        </ol>
      </div>
    </div>
  </section>

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
        :value="query"
        placeholder="筛选任务/样品/位置/状态"
        @input="setQuery($event.target.value)"
      />
      <select
        class="search-input"
        data-testid="samples-flow-task-filter"
        :value="selectedFlowTaskCode"
        @change="setTaskFilter($event.target.value)"
      >
        <option value="">全部任务</option>
        <option v-for="taskCode in samplesFlowTaskOptions" :key="taskCode" :value="taskCode">
          {{ taskCode }}
        </option>
      </select>
      <select
        class="search-input"
        data-testid="samples-flow-status-filter"
        :value="selectedFlowStatus"
        @change="setStatusFilter($event.target.value)"
      >
        <option value="">全部状态</option>
        <option v-for="status in samplesFlowStatusOptions" :key="status" :value="status">
          {{ status }}
        </option>
      </select>
      <button class="action-btn" type="button" data-testid="samples-flow-open-batch" @click="openBatchModal">
        批量入库
      </button>
      <AppPagination
        :current-page="samplesFlowCurrentPage"
        :page-count="samplesFlowPageCount"
        @change="setSamplesFlowPage"
      />
    </div>
    <table class="table">
      <thead>
        <tr>
          <th>序号</th>
          <th
            data-testid="samples-flow-sort-task"
            :data-sort-dir="samplesFlowSortKey === 'task_code' ? samplesFlowSortDirection : ''"
            @click="toggleSamplesFlowSort('task_code')"
          >
            任务
          </th>
          <th
            data-testid="samples-flow-sort-code"
            :data-sort-dir="samplesFlowSortKey === 'code' ? samplesFlowSortDirection : ''"
            @click="toggleSamplesFlowSort('code')"
          >
            样品编号
          </th>
          <th
            data-testid="samples-flow-sort-tray"
            :data-sort-dir="samplesFlowSortKey === 'trayCount' ? samplesFlowSortDirection : ''"
            @click="toggleSamplesFlowSort('trayCount')"
          >
            托盘数
          </th>
          <th
            data-testid="samples-flow-sort-location"
            :data-sort-dir="samplesFlowSortKey === 'location' ? samplesFlowSortDirection : ''"
            @click="toggleSamplesFlowSort('location')"
          >
            当前位置
          </th>
          <th
            data-testid="samples-flow-sort-owner"
            :data-sort-dir="samplesFlowSortKey === 'owner' ? samplesFlowSortDirection : ''"
            @click="toggleSamplesFlowSort('owner')"
          >
            责任人
          </th>
          <th
            data-testid="samples-flow-sort-status"
            :data-sort-dir="samplesFlowSortKey === 'status' ? samplesFlowSortDirection : ''"
            @click="toggleSamplesFlowSort('status')"
          >
            状态
          </th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="samplesFlowRows.length === 0">
          <td colspan="8" class="muted">暂无样品数据</td>
        </tr>
        <tr v-for="(row, index) in samplesFlowRows" :key="row.id || row.code">
          <td>{{ (samplesFlowCurrentPage - 1) * 8 + index + 1 }}</td>
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
              @click="openSampleDetail(row.id || row.code)"
            >
              详情
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="form-alert" :class="{ 'is-hidden': !samplesFlowWarning }">{{ samplesFlowWarning }}</div>
  </section>

  <section class="card section" :class="{ 'is-hidden': activeSamplesTab !== 'sample-staging' }" data-testid="samples-staging-panel">
    <h3>暂存间派发</h3>
    <div class="toolbar">
      <div class="muted" data-testid="samples-staging-count">暂存间未试验样品 {{ stagingCount }}</div>
      <input
        :value="stagingQuery"
        class="search-input"
        data-testid="samples-staging-search"
        placeholder="筛选样品/任务/状态"
        @input="setStagingQuery($event.target.value)"
      />
    </div>
    <table class="table" data-testid="samples-staging-table">
      <thead>
        <tr>
          <th style="width: 56px;">
            <input
              :checked="stagingAllSelected"
              data-testid="samples-staging-select-all"
              type="checkbox"
              @change="toggleAllStagingSelection($event.target.checked)"
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
        <tr v-if="stagingRows.length === 0">
          <td colspan="7" class="muted">暂无可派发样品</td>
        </tr>
        <tr v-for="(row, index) in stagingRows" :key="row.id || row.code">
          <td>
            <input
              :checked="row.selected"
              :data-testid="`samples-staging-select-${index}`"
              type="checkbox"
              @change="toggleStagingSelection(row.code, $event.target.checked)"
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
          v-model="stagingForm.codes"
          data-testid="samples-staging-codes"
          placeholder="输入或扫描样品编号；也可直接勾选上方样品"
        ></textarea>
      </div>
      <div class="form-field">
        <label>目标实验室</label>
        <select v-model="stagingForm.targetLab" data-testid="samples-staging-target-lab">
          <option value="">请选择实验室</option>
          <option v-for="lab in stagingLabOptions" :key="lab" :value="lab">
            {{ lab }}
          </option>
        </select>
      </div>
      <div class="form-field">
        <label>责任人</label>
        <input
          v-model="stagingForm.owner"
          data-testid="samples-staging-owner"
          type="text"
          placeholder="负责人姓名"
        />
      </div>
    </div>
    <div class="form-actions">
      <button class="action-btn" data-testid="samples-staging-submit" type="button" @click="submitStagingDispatch">
        派发至实验室
      </button>
      <button class="action-btn secondary" data-testid="samples-staging-reset" type="button" @click="resetStaging">
        清空输入
      </button>
    </div>
    <div class="form-alert" :class="{ 'is-hidden': !samplesFlowWarning }">{{ samplesFlowWarning }}</div>
  </section>

  <section class="card section">
    <h3>样品全生命周期追踪</h3>
    <form>
      <div class="form-grid">
        <div class="form-field">
          <label>试验序号</label>
          <input
            v-model="sampleTraceForm.task_code"
            data-testid="sample-trace-task-code"
            type="text"
            name="task_code"
            placeholder="例如：SZH-2024-003"
          />
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#" data-testid="sample-trace-run" @click.prevent="runTrace">查询</a>
        <a class="action-btn secondary" href="#" data-testid="sample-trace-reset" @click.prevent="resetTrace">清空</a>
      </div>
    </form>
    <div class="muted" data-testid="sample-trace-summary-text">{{ sampleTraceSummaryText }}</div>
    <div class="timeline" data-testid="sample-trace-timeline-list">
      <div v-for="item in sampleTraceTimelineItems" :key="item.id" class="timeline-item">
        <div class="timeline-dot"></div>
        <div>
          <div>{{ item.title }}</div>
          <div class="muted">{{ item.meta }}</div>
        </div>
      </div>
    </div>
  </section>

  <AppModal :open="samplesFlowBatchOpen" title="批量入库" @close="closeBatchModal">
    <div class="form-grid">
      <div class="form-field">
        <label>入库位置</label>
        <select v-model="samplesFlowBatchForm.location" data-testid="samples-flow-batch-location">
          <option value="">请选择实验室</option>
          <option v-for="location in samplesFlowLocationOptions" :key="location" :value="location">
            {{ location }}
          </option>
        </select>
      </div>
      <div class="form-field">
        <label>责任人</label>
        <input v-model="samplesFlowBatchForm.owner" data-testid="samples-flow-batch-owner" type="text" placeholder="负责人姓名" />
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>样品列表</label>
        <textarea
          v-model="samplesFlowBatchForm.codes"
          data-testid="samples-flow-batch-codes"
          placeholder="输入或扫描多个样品编号"
        ></textarea>
      </div>
    </div>
    <div class="form-alert" :class="{ 'is-hidden': !samplesFlowWarning }">{{ samplesFlowWarning }}</div>
    <template #footer>
      <button class="action-btn" type="button" data-testid="samples-flow-batch-submit" @click="submitSamplesFlowBatch">
        确认入库
      </button>
      <button class="action-btn secondary" type="button" @click="closeBatchModal">取消</button>
    </template>
  </AppModal>

  <AppDrawer :open="samplesFlowDetailOpen" title="样品详情" @close="closeSampleDetail">
    <div class="form-grid">
      <div class="form-field">
        <label>样品编号</label>
        <input :value="samplesFlowDetailForm.code" data-testid="samples-flow-detail-code" type="text" readonly />
      </div>
      <div class="form-field">
        <label>状态</label>
        <select v-model="samplesFlowDetailForm.status" data-testid="samples-flow-detail-status">
          <option v-for="status in samplesFlowDetailStatusOptions" :key="status" :value="status">
            {{ status }}
          </option>
        </select>
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>流转备注</label>
        <textarea
          v-model="samplesFlowDetailForm.remark"
          data-testid="samples-flow-detail-remark"
          placeholder="更新流转信息"
        ></textarea>
      </div>
    </div>
    <div class="form-alert" :class="{ 'is-hidden': !samplesFlowWarning }">{{ samplesFlowWarning }}</div>
    <template #footer>
      <button class="action-btn" type="button" data-testid="samples-flow-detail-save" @click="saveSampleDetail">
        保存修改
      </button>
      <button class="action-btn secondary" type="button" @click="closeSampleDetail">取消</button>
    </template>
  </AppDrawer>
</template>

<script setup>
import AppDrawer from "@/components/shared/AppDrawer.vue";
import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import { useSampleIntake } from "./useSampleIntake";
import { useSampleTrace } from "./useSampleTrace";
import { useSamplesFlow } from "./useSamplesFlow";
import { useSamplesProcess } from "./useSamplesProcess";
import { useTabState } from "@/composables/useTabState";

const {
  form: sampleIntakeForm,
  saveDraft: saveSampleIntakeDraft,
  setTaskCode: setSampleIntakeTaskCode,
  submit: submitSampleIntake,
  taskOptions: sampleIntakeTaskOptions,
  warning: sampleIntakeWarning,
} = useSampleIntake();

const {
  form: sampleTraceForm,
  resetTrace,
  runTrace,
  summaryText: sampleTraceSummaryText,
  timelineItems: sampleTraceTimelineItems,
} = useSampleTrace();

const { activeTab: activeSamplesTab, setActiveTab: setActiveSamplesTab } = useTabState("sample-flow");

const {
  activeTrayIndex,
  addTray,
  canPrint,
  confirmStore,
  currentFlowStatus,
  flowSteps,
  handleTrayDrop,
  moveToActiveTray,
  printTrays,
  restoreStore,
  sampleCodesText,
  selectTask,
  selectedTaskCode,
  setActiveTray,
  setTrayLimit,
  storeLocked,
  startDragging,
  taskOptions,
  trayDraft,
  trayPreviewText,
  warning,
  removeTray,
} = useSamplesProcess();

const {
  batchForm: samplesFlowBatchForm,
  batchModalOpen: samplesFlowBatchOpen,
  closeBatchModal,
  closeDetailDrawer: closeSampleDetail,
  currentPage: samplesFlowCurrentPage,
  detailDrawerOpen: samplesFlowDetailOpen,
  detailForm: samplesFlowDetailForm,
  detailStatusOptions: samplesFlowDetailStatusOptions,
  locationOptions: samplesFlowLocationOptions,
  openBatchModal,
  openDetailDrawer: openSampleDetail,
  pageCount: samplesFlowPageCount,
  query,
  sampleRows: samplesFlowRows,
  saveDetail: saveSampleDetail,
  selectedStatus: selectedFlowStatus,
  selectedTaskCode: selectedFlowTaskCode,
  setPage: setSamplesFlowPage,
  setQuery,
  setStagingQuery,
  setStatusFilter,
  setTaskFilter,
  sortDirection: samplesFlowSortDirection,
  sortKey: samplesFlowSortKey,
  stagingAllSelected,
  stagingCount,
  stagingForm,
  stagingLabOptions,
  stagingQuery,
  stagingRows,
  statusOptions: samplesFlowStatusOptions,
  submitStagingDispatch,
  submitBatch: submitSamplesFlowBatch,
  taskOptions: samplesFlowTaskOptions,
  toggleAllStagingSelection,
  toggleStagingSelection,
  toggleSort: toggleSamplesFlowSort,
  warning: samplesFlowWarning,
  resetStaging,
} = useSamplesFlow();
</script>
