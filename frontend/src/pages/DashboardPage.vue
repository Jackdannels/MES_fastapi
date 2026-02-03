<template>
  <section class="grid cols-4 stagger">
    <div class="card">
      <div class="muted">今日受理</div>
      <div class="kpi" id="dashboard-intake-count">0</div>
      <div class="muted" id="dashboard-intake-note">外部 0 / 内部 0</div>
    </div>
    <div class="card">
      <div class="muted">已排程</div>
      <div class="kpi" id="dashboard-scheduled-count">0</div>
      <div class="muted">未来 48 小时</div>
    </div>
    <div class="card">
      <div class="muted">待排程</div>
      <div class="kpi" id="dashboard-unscheduled-count">0</div>
      <div class="muted">需设备空闲</div>
    </div>
    <div class="card">
      <div class="muted">正在运行</div>
      <div class="kpi" id="dashboard-device-count">0</div>
      <div class="muted" id="dashboard-device-note">实验中任务</div>
    </div>
    <div class="card">
      <div class="muted">预警</div>
      <div class="kpi" id="dashboard-alert-count">0</div>
      <div class="muted" id="dashboard-alert-note">无预警</div>
    </div>
  </section>

  <section class="grid cols-3 section">
    <div class="card">
      <div class="dashboard-task-header">
        <h3>任务队列</h3>
        <div class="dashboard-task-pagination" id="dashboard-task-pagination"></div>
      </div>
      <table class="table" data-sortable>
        <thead>
          <tr>
            <th data-sort>任务</th>
            <th data-sort>来源</th>
            <th data-sort>状态</th>
          </tr>
        </thead>
        <tbody id="dashboard-task-body"></tbody>
      </table>
    </div>
    <div class="card">
      <h3>设备空闲</h3>
      <div class="timeline" id="dashboard-device-list"></div>
    </div>
    <div class="card">
      <h3>数据通道</h3>
      <div class="muted">Modbus 采集健康度</div>
      <div class="kpi" id="dashboard-data-health">0%</div>
      <div class="muted" id="dashboard-data-gap">暂无缺口</div>
    </div>
  </section>
</template>
