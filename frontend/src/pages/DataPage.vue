<template>
  <section class="grid cols-3 stagger">
    <div class="card">
      <div class="muted">自动采集流</div>
      <div class="kpi" id="data-stream-count">{{ metrics.streamCount }}</div>
      <div class="muted">Modbus 节点在线</div>
    </div>
    <div class="card">
      <div class="muted">校验队列</div>
      <div class="kpi" id="data-validation-count">{{ metrics.validationCount }}</div>
      <div class="muted">待复核</div>
    </div>
    <div class="card">
      <div class="muted">报告待出</div>
      <div class="kpi" id="data-report-count">{{ metrics.reportCount }}</div>
      <div class="muted">固定模板</div>
    </div>
  </section>

  <section class="card section">
    <h3>采集监控</h3>
    <div class="toolbar">
      <input v-model="query" class="search-input" placeholder="筛选任务/设备/状态" />
    </div>
    <table class="table" id="data-table">
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort @click="toggleSort('taskCode')">任务</th>
          <th data-sort @click="toggleSort('device')">设备</th>
          <th data-sort @click="toggleSort('lastPacket')">最近数据包</th>
          <th data-sort @click="toggleSort('quality')">数据质量</th>
          <th data-sort @click="toggleSort('status')">状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="data-table-body">
        <tr v-for="(row, index) in dataRows" :key="row.id">
          <td>{{ index + 1 }}</td>
          <td>{{ row.taskCode }}</td>
          <td>{{ row.device }}</td>
          <td>{{ row.lastPacket }}</td>
          <td>{{ row.quality }}</td>
          <td><span :class="row.statusClass">{{ row.status }}</span></td>
          <td>
            <button class="action-link" :data-testid="`open-data-drawer-${index}`" type="button" @click="openDataDrawer(row)">
              详情
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card section">
    <h3>数据校验与报告</h3>
    <div class="form-grid">
      <div class="form-field">
        <label>校验规则</label>
        <select v-model="reportForm.rule" name="rule">
          <option>完整性校验</option>
          <option>范围校验</option>
          <option>时间戳一致性</option>
        </select>
      </div>
      <div class="form-field">
        <label>报告模板</label>
        <select v-model="reportForm.template" name="template">
          <option>重金属检测固定模板</option>
          <option>含量检测固定模板</option>
          <option>稳定性固定模板</option>
        </select>
      </div>
      <div class="form-field">
        <label>关联任务</label>
        <input v-model="reportForm.taskCode" type="text" name="task_code" placeholder="任务编号" />
      </div>
      <div class="form-field">
        <label>开始时间</label>
        <input v-model="reportForm.rangeStart" type="datetime-local" name="range_start" />
      </div>
      <div class="form-field">
        <label>结束时间</label>
        <input v-model="reportForm.rangeEnd" type="datetime-local" name="range_end" />
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>异常说明</label>
        <textarea v-model="reportForm.remark" name="remark" placeholder="记录异常数据原因与处理方式"></textarea>
      </div>
    </div>
    <div class="form-actions">
      <button class="action-btn" data-testid="data-validate" type="button" @click="validateReport">执行校验</button>
      <button class="action-btn secondary" data-testid="open-report-modal" type="button" @click="openReportModal">生成报告</button>
    </div>
  </section>

  <AppModal :open="reportModalOpen" title="报告预览" @close="closeReportModal">
    <p class="muted">将使用固定模板生成报告，包含任务信息、设备数据与结论摘要。</p>
    <template #footer>
      <button class="action-btn" type="button" @click="generateReport">确认生成</button>
      <button class="action-btn secondary" type="button" @click="closeReportModal">取消</button>
    </template>
  </AppModal>

  <AppDrawer :open="dataDrawerOpen" title="数据明细" @close="closeDataDrawer">
    <div class="form-grid">
      <div class="form-field">
        <label>采集状态</label>
        <select :value="selectedRow.status">
          <option>采集中</option>
          <option>已完成</option>
          <option>有缺口</option>
        </select>
      </div>
      <div class="form-field">
        <label>数据质量</label>
        <input :value="selectedRow.quality" type="text" placeholder="98.8%" />
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>异常记录</label>
        <textarea :value="selectedRow.taskCode" placeholder="记录缺口或异常信息"></textarea>
      </div>
    </div>
  </AppDrawer>
</template>

<script setup>
import AppDrawer from "@/components/shared/AppDrawer.vue";
import AppModal from "@/components/shared/AppModal.vue";
import { useDataPage } from "@/composables/useDataPage";

const {
  closeDataDrawer,
  closeReportModal,
  dataDrawerOpen,
  dataRows,
  generateReport,
  metrics,
  openDataDrawer,
  openReportModal,
  query,
  reportForm,
  reportModalOpen,
  selectedRow,
  toggleSort,
  validateReport,
} = useDataPage();
</script>
