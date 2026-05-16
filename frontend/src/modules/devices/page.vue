<template>
  <div class="devices-page">
  <section class="grid cols-3 stagger">
    <div class="card">
      <div class="muted">可用设备</div>
      <div class="kpi" id="device-idle-count">{{ metrics.idleCount }}</div>
      <div class="muted">可排程</div>
    </div>
    <div class="card">
      <div class="muted">使用中</div>
      <div class="kpi" id="device-active-count">{{ metrics.activeCount }}</div>
      <div class="muted">自动采集中</div>
    </div>
    <div class="card">
      <div class="muted">维护/校准</div>
      <div class="kpi" id="device-maintenance-count">{{ metrics.maintenanceCount }}</div>
      <div class="muted">待处理</div>
    </div>
  </section>

  <section class="card section devices-registry-card">
    <h3>设备台账</h3>
    <form>
      <div class="form-grid">
        <div class="form-field">
          <label>设备编号</label>
          <input v-model="deviceForm.code" type="text" name="code" placeholder="例如：HPLC-03" />
        </div>
        <div class="form-field">
          <label>设备名称</label>
          <input v-model="deviceForm.name" type="text" name="name" placeholder="高效液相色谱仪" />
        </div>
        <div class="form-field">
          <label>试验类型</label>
          <select v-model="deviceForm.type" name="type">
            <option value="">请选择试验类型</option>
            <option v-for="type in testTypeOptions" :key="type" :value="type">{{ type }}</option>
          </select>
        </div>
        <div class="form-field">
          <label>型号/规格</label>
          <input v-model="deviceForm.model" type="text" name="model" placeholder="型号或规格" />
        </div>
        <div class="form-field">
          <label>负责人</label>
          <input v-model="deviceForm.owner" type="text" name="owner" placeholder="设备负责人" />
        </div>
        <div class="form-field">
          <label>状态</label>
          <select v-model="deviceForm.status" name="status">
            <option>可用</option>
            <option>使用中</option>
            <option>维护/校准</option>
            <option>停用</option>
          </select>
        </div>
        <div class="form-field">
          <label>位置</label>
          <select v-model="deviceForm.location" name="location">
            <option value="">请选择实验室</option>
            <option v-for="location in locationOptions" :key="location" :value="location">{{ location }}</option>
          </select>
        </div>
        <div class="form-field">
          <label>下次校准时间</label>
          <PickerOnlyInput v-model="deviceForm.next_cal" type="date" name="next_cal" />
        </div>
        <div class="form-field">
          <label>采集启用</label>
          <select v-model="deviceForm.acquisition_enabled" name="acquisition_enabled">
            <option>启用</option>
            <option>停用</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button class="action-btn" data-testid="device-save" type="button" @click="saveCurrentDevice">保存设备</button>
        <button class="action-btn secondary" data-testid="device-add" type="button" @click="createNewDevice">新增设备</button>
        <button class="action-btn secondary" data-testid="open-device-drawer" type="button" @click="openDeviceDrawer()">
          维护记录
        </button>
      </div>
    </form>
  </section>

  <section class="card section devices-table-card">
    <h3>设备列表</h3>
    <div class="toolbar">
      <input v-model="query" class="search-input" placeholder="筛选设备/状态/位置" />
    </div>
    <table class="table" id="device-table">
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort :data-sort-dir="sortKey === 'code' ? sortDirection : ''" @click="toggleSort('code')">设备编号</th>
          <th data-sort :data-sort-dir="sortKey === 'name' ? sortDirection : ''" @click="toggleSort('name')">设备名称</th>
          <th data-sort :data-sort-dir="sortKey === 'type' ? sortDirection : ''" @click="toggleSort('type')">试验类型</th>
          <th data-sort :data-sort-dir="sortKey === 'status' ? sortDirection : ''" @click="toggleSort('status')">状态</th>
          <th data-sort :data-sort-dir="sortKey === 'location' ? sortDirection : ''" @click="toggleSort('location')">位置</th>
          <th data-sort :data-sort-dir="sortKey === 'nextCal' ? sortDirection : ''" @click="toggleSort('nextCal')">下次校准</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="device-table-body">
        <tr v-for="(row, index) in deviceRows" :key="row.id">
          <td>{{ index + 1 }}</td>
          <td>{{ row.code }}</td>
          <td>{{ row.name }}</td>
          <td>{{ row.type }}</td>
          <td><span :class="row.statusClass">{{ row.status }}</span></td>
          <td>{{ row.location }}</td>
          <td>{{ row.nextCal }}</td>
          <td>
            <button class="action-link" :data-testid="`open-device-drawer-${index}`" type="button" @click="openDeviceDrawer(row)">
              详情
            </button>
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
        <input v-model="connectionForm.stationId" type="number" placeholder="例如：1" />
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

  <AppDrawer :open="deviceDrawerOpen" title="设备维护记录" @close="closeDeviceDrawer">
    <div class="form-grid">
      <div class="form-field">
        <label>设备编号</label>
        <input :value="selectedDevice.code" type="text" placeholder="设备编号" />
      </div>
      <div class="form-field">
        <label>设备名称</label>
        <input :value="selectedDevice.name" type="text" placeholder="设备名称" />
      </div>
      <div class="form-field">
        <label>最近校准</label>
        <PickerOnlyInput v-model="maintenanceForm.latestCalibration" type="date" />
      </div>
      <div class="form-field">
        <label>维护类型</label>
        <select v-model="maintenanceForm.maintenanceType">
          <option>校准</option>
          <option>保养</option>
          <option>维修</option>
        </select>
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>维护记录</label>
        <textarea v-model="maintenanceForm.record" placeholder="记录维护内容与结果"></textarea>
      </div>
    </div>
  </AppDrawer>
  </div>
</template>

<script setup>
defineOptions({
  name: "DevicesPage",
});

import AppDrawer from "@/components/shared/AppDrawer.vue";
import AppModal from "@/components/shared/AppModal.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";
import { useDevicesPage } from "./useDevicesPage";

const {
  closeDeviceDrawer,
  closePointModal,
  connectionForm,
  createNewDevice,
  deviceDrawerOpen,
  deviceForm,
  deviceRows,
  locationOptions,
  maintenanceForm,
  metrics,
  openDeviceDrawer,
  openPointModal,
  pointForm,
  pointModalOpen,
  pointQuery,
  pointRows,
  query,
  saveCurrentDevice,
  savePoint,
  selectedDevice,
  sortDirection,
  sortKey,
  testTypeOptions,
  toggleSort,
} = useDevicesPage();
</script>
