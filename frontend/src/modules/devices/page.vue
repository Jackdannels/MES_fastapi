<template>
  <div class="devices-page">
  <section class="grid cols-3 stagger">
    <div class="card">
      <div class="muted">可用设备</div>
      <div class="kpi" id="device-idle-count">{{ metrics.idleCount }}</div>
      <div class="muted">可排程</div>
    </div>
    <div class="card">
      <div class="muted">工作中</div>
      <div class="kpi" id="device-active-count">{{ metrics.activeCount }}</div>
      <div class="muted">自动采集中</div>
    </div>
    <div class="card">
      <div class="muted">维保中</div>
      <div class="kpi" id="device-maintenance-count">{{ metrics.maintenanceCount }}</div>
      <div class="muted">待处理</div>
    </div>
  </section>

  <section class="card section devices-registry-card">
    <h3>设备列表</h3>
    <div class="toolbar">
      <input v-model="query" class="search-input" placeholder="筛选设备/状态/位置" />
      <button class="action-btn secondary" data-testid="open-device-drawer" type="button" @click="openDeviceDrawer()">
        维保记录
      </button>
    </div>
    <table class="table" id="device-table">
      <thead>
        <tr>
          <th class="devices-sequence-column">序号</th>
          <th data-sort :data-sort-dir="sortKey === 'code' ? sortDirection : ''" @click="toggleSort('code')">设备编号</th>
          <th data-sort :data-sort-dir="sortKey === 'name' ? sortDirection : ''" @click="toggleSort('name')">设备名称</th>
          <th data-sort :data-sort-dir="sortKey === 'type' ? sortDirection : ''" @click="toggleSort('type')">试验类型</th>
          <th data-sort :data-sort-dir="sortKey === 'status' ? sortDirection : ''" @click="toggleSort('status')">状态</th>
          <th data-sort :data-sort-dir="sortKey === 'location' ? sortDirection : ''" @click="toggleSort('location')">位置</th>
          <th>下次维保</th>
          <th>维保计划结束时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="device-table-body">
        <tr v-for="(row, index) in deviceRows" :key="row.id">
          <td class="devices-sequence-column">{{ index + 1 }}</td>
          <td>{{ row.code }}</td>
          <td>{{ row.name }}</td>
          <td>{{ row.type }}</td>
          <td><span :class="row.statusClass">{{ row.status }}</span></td>
          <td>{{ row.location }}</td>
          <td>{{ row.nextMaintenanceAt }}</td>
          <td>{{ row.maintenancePlanEndAt }}</td>
          <td>
            <div class="devices-action-cell">
              <button
                class="action-link devices-action-link"
                :data-testid="`open-device-edit-${index}`"
                type="button"
                @click="openEditDevice(row)"
              >
                编辑
              </button>
              <button
                class="action-link devices-action-link devices-action-link--maintenance"
                :data-testid="`open-maintenance-plan-${index}`"
                type="button"
                @click="openMaintenancePlan(row)"
              >
                维保计划
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card section devices-connection-card">
    <h3>Modbus 连接配置</h3>
    <div class="form-grid">
      <div class="form-field">
        <label>协议</label>
        <select v-model="connectionForm.protocol">
          <option>TCP</option>
          <option>RTU</option>
        </select>
      </div>
      <div class="form-field">
        <label>IP/串口</label>
        <input v-model="connectionForm.endpoint" type="text" placeholder="TCP: 10.10.0.23 / RTU: COM3" />
      </div>
      <div class="form-field">
        <label>端口/波特率</label>
        <input v-model="connectionForm.port" type="text" placeholder="TCP: 502 / RTU: 9600" />
      </div>
      <div class="form-field">
        <label>从站地址</label>
        <AppNumberInput v-model="connectionForm.stationId" placeholder="例如：1" />
      </div>
      <div class="form-field">
        <label>功能码</label>
        <select v-model="connectionForm.functionCode">
          <option>03 读保持寄存器</option>
          <option>04 读输入寄存器</option>
          <option>01 读线圈</option>
          <option>02 读离散输入</option>
        </select>
      </div>
      <div class="form-field">
        <label>采样周期</label>
        <input v-model="connectionForm.pollingInterval" type="text" placeholder="例如：1s" />
      </div>
      <div class="form-field">
        <label>超时/重试</label>
        <input v-model="connectionForm.retryPolicy" type="text" placeholder="例如：3s / 2次" />
      </div>
      <div class="form-field">
        <label>数据校验</label>
        <select v-model="connectionForm.parity">
          <option>CRC</option>
          <option>无</option>
        </select>
      </div>
    </div>
    <div class="form-actions">
      <button class="action-btn" type="button">测试连接</button>
      <button class="action-btn secondary" type="button">保存配置</button>
    </div>
  </section>

  <section class="card section devices-points-card">
    <h3>点位映射</h3>
    <div class="toolbar">
      <input v-model="pointQuery" class="search-input" placeholder="筛选点位/地址/单位" />
      <button class="action-btn" data-testid="open-point-modal" type="button" @click="openPointModal">新增点位</button>
      <button class="action-btn secondary" type="button">导入模板</button>
    </div>
    <table class="table" id="point-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>点位名称</th>
          <th>寄存器地址</th>
          <th>数据类型</th>
          <th>比例系数</th>
          <th>单位</th>
          <th>频率</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(point, index) in pointRows" :key="point.id">
          <td>{{ index + 1 }}</td>
          <td>{{ point.name }}</td>
          <td>{{ point.address }}</td>
          <td>{{ point.dataType }}</td>
          <td>{{ point.ratio }}</td>
          <td>{{ point.unit }}</td>
          <td>{{ point.frequency }}</td>
          <td>{{ point.note }}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <AppModal :open="pointModalOpen" title="新增点位" @close="closePointModal">
    <div class="form-grid">
      <div class="form-field">
        <label>点位名称</label>
        <input v-model="pointForm.name" type="text" placeholder="例如：温度" />
      </div>
      <div class="form-field">
        <label>寄存器地址</label>
        <input v-model="pointForm.address" type="text" placeholder="40001" />
      </div>
      <div class="form-field">
        <label>数据类型</label>
        <select v-model="pointForm.dataType">
          <option>INT16</option>
          <option>UINT16</option>
          <option>FLOAT32</option>
        </select>
      </div>
      <div class="form-field">
        <label>比例系数</label>
        <input v-model="pointForm.ratio" type="text" placeholder="0.1" />
      </div>
      <div class="form-field">
        <label>单位</label>
        <input v-model="pointForm.unit" type="text" placeholder="°C" />
      </div>
      <div class="form-field">
        <label>采样频率</label>
        <input v-model="pointForm.frequency" type="text" placeholder="1s" />
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>备注</label>
        <textarea v-model="pointForm.note" placeholder="说明点位用途"></textarea>
      </div>
    </div>
    <template #footer>
      <button class="action-btn" type="button" @click="savePoint">保存点位</button>
      <button class="action-btn secondary" type="button" @click="closePointModal">取消</button>
    </template>
  </AppModal>

  <AppModal :open="editDeviceOpen" title="编辑设备" @close="closeEditDevice">
    <div class="form-grid">
      <div class="form-field">
        <label>设备编号</label>
        <input v-model="deviceForm.code" type="text" readonly />
      </div>
      <div class="form-field">
        <label>设备名称</label>
        <input v-model="deviceForm.name" type="text" placeholder="设备名称" />
      </div>
      <div class="form-field">
        <label>设备当前状态</label>
        <div class="device-status-field" data-testid="device-status-field">
          <div :class="['device-status-display', editDeviceStatusClass]" data-testid="device-edit-status" role="status">
            {{ deviceForm.status }}
          </div>
          <button
            class="action-btn secondary"
            type="button"
            data-testid="device-set-available"
            :disabled="!canSetDeviceAvailable"
            @click="setDeviceAvailable"
          >
            {{ deviceLifecycleActionLabel }}
          </button>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="action-btn secondary" type="button" @click="closeEditDevice">取消</button>
      <button class="action-btn" type="button" data-testid="device-edit-confirm" @click="saveEditedDevice">确定</button>
    </template>
  </AppModal>

  <AppModal :open="maintenancePlanOpen" title="维保计划" @close="closeMaintenancePlan">
    <div class="form-grid">
      <div class="form-field">
        <label>设备编号</label>
        <input :value="selectedDevice.code" type="text" readonly />
      </div>
      <div class="form-field">
        <label>设备名称</label>
        <input :value="selectedDevice.name" type="text" readonly />
      </div>
      <div class="form-field">
        <label>维保类型</label>
        <select v-model="maintenancePlanForm.type" name="maintenance_type">
          <option>计划维修</option>
          <option>维修</option>
          <option>计划保养</option>
          <option>保养</option>
        </select>
      </div>
      <div class="form-field">
        <label>开始时间</label>
        <PickerOnlyInput
          v-model="maintenancePlanForm.startAt"
          :disabled="!maintenancePlanIsPlanned"
          data-testid="maintenance-start-at"
          name="maintenance_start_at"
          type="datetime-local"
        />
      </div>
      <div class="form-field">
        <label>结束时间</label>
        <PickerOnlyInput
          v-model="maintenancePlanForm.endAt"
          :disabled="!maintenancePlanIsPlanned"
          :min="maintenancePlanEndMin || undefined"
          data-testid="maintenance-end-at"
          name="maintenance_end_at"
          type="datetime-local"
        />
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>备注</label>
        <textarea v-model="maintenancePlanForm.note" placeholder="维保说明"></textarea>
      </div>
      <div v-if="maintenancePlanWarning" class="form-alert" data-testid="maintenance-plan-warning">
        {{ maintenancePlanWarning }}
      </div>
    </div>
    <template #footer>
      <button class="action-btn secondary" type="button" @click="closeMaintenancePlan">取消</button>
      <button class="action-btn" type="button" data-testid="maintenance-plan-save" @click="saveMaintenancePlan">确定</button>
    </template>
  </AppModal>

  <AppModal :open="runningRepairChoiceOpen" title="设备维修确认" @close="closeRunningRepairChoice">
    <div class="devices-maintenance-conflict" data-testid="running-repair-choice-modal">
      <strong>当前试验间正在进行实验。</strong>
      <p>维修会立即生效，请选择当前实验的处理方式。</p>
      <ul>
        <li v-for="schedule in runningRepairChoiceDetail?.runningSchedules || []" :key="schedule.id">
          {{ schedule.task_code }} / {{ schedule.experiment_code || "-" }}
        </li>
      </ul>
    </div>
    <template #footer>
      <button class="action-btn secondary" type="button" @click="closeRunningRepairChoice">取消</button>
      <button class="action-btn secondary" type="button" data-testid="running-repair-reschedule" @click="confirmRunningRepairReschedule">
        重新排程
      </button>
      <button class="action-btn" type="button" data-testid="running-repair-complete" @click="confirmRunningRepairComplete">
        设为实验已完成
      </button>
    </template>
  </AppModal>

  <AppModal :open="maintenanceConflictOpen" title="维保计划冲突确认" @close="cancelMaintenanceConflict">
    <div class="devices-maintenance-conflict" data-testid="maintenance-conflict-modal">
      <strong>计划维保时间与已排程设备阶段重叠。</strong>
      <p>确认后会删除该设备在维保时间内的排程信息，并同步至排程页异常处理。</p>
      <ul>
        <li v-for="schedule in maintenanceConflictDetail?.conflictingSchedules || []" :key="schedule.id">
          {{ schedule.task_code }} / {{ schedule.experiment_code || "-" }} / {{ schedule.start_at }} - {{ schedule.end_at }}
        </li>
      </ul>
    </div>
    <template #footer>
      <button class="action-btn secondary" type="button" @click="cancelMaintenanceConflict">取消</button>
      <button class="action-btn" type="button" data-testid="maintenance-conflict-confirm" @click="confirmMaintenanceConflict">
        确认删除排程
      </button>
    </template>
  </AppModal>

  <AppModal :open="deviceDrawerOpen" content-class="devices-maintenance-record-modal" title="设备维保记录" @close="closeDeviceDrawer">
    <div class="devices-maintenance-records">
      <div class="form-field devices-maintenance-record-filter">
        <label for="maintenance-record-device">设备</label>
        <select id="maintenance-record-device" v-model="maintenanceRecordDeviceFilter">
          <option value="">全部设备</option>
          <option v-for="row in deviceRows" :key="row.code" :value="row.code">{{ row.code }} / {{ row.name }}</option>
        </select>
      </div>
      <div class="devices-maintenance-record-table-wrap">
        <table class="table devices-maintenance-record-table">
          <thead>
            <tr>
              <th>设备</th>
              <th>维保类型</th>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>维保说明</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in maintenanceRecordRows" :key="record.id">
              <td>{{ record.device_code }} / {{ record.device_name }}</td>
              <td>{{ record.maintenance_type }}</td>
              <td>{{ record.started_at || "/" }}</td>
              <td>{{ record.ended_at || "/" }}</td>
              <td>{{ record.maintenance_note || "/" }}</td>
              <td>{{ record.status }}</td>
            </tr>
            <tr v-if="maintenanceRecordRows.length === 0">
              <td class="devices-maintenance-record-empty" colspan="6">暂无维保记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template #footer>
      <button class="action-btn secondary" type="button" @click="closeDeviceDrawer">关闭</button>
    </template>
  </AppModal>
  </div>
</template>

<script setup>
defineOptions({
  name: "DevicesPage",
});

import AppModal from "@/components/shared/AppModal.vue";
import AppNumberInput from "@/components/shared/AppNumberInput.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";
import { useDevicesPage } from "./useDevicesPage";

const {
  cancelMaintenanceConflict,
  canSetDeviceAvailable,
  closeRunningRepairChoice,
  closeDeviceDrawer,
  closeEditDevice,
  closeMaintenancePlan,
  closePointModal,
  confirmMaintenanceConflict,
  confirmRunningRepairComplete,
  confirmRunningRepairReschedule,
  connectionForm,
  deviceDrawerOpen,
  deviceForm,
  deviceLifecycleActionLabel,
  deviceRows,
  editDeviceStatusClass,
  editDeviceOpen,
  maintenanceConflictDetail,
  maintenanceConflictOpen,
  maintenanceRecordDeviceFilter,
  maintenanceRecordRows,
  maintenancePlanForm,
  maintenancePlanEndMin,
  maintenancePlanIsPlanned,
  maintenancePlanWarning,
  maintenancePlanOpen,
  metrics,
  openEditDevice,
  openDeviceDrawer,
  openMaintenancePlan,
  openPointModal,
  pointForm,
  pointModalOpen,
  pointQuery,
  pointRows,
  query,
  runningRepairChoiceDetail,
  runningRepairChoiceOpen,
  saveEditedDevice,
  saveMaintenancePlan,
  savePoint,
  selectedDevice,
  setDeviceAvailable,
  sortDirection,
  sortKey,
  toggleSort,
} = useDevicesPage();
</script>
