<template>
  <div class="tabs section" data-tab-group="schedule-board" data-tab-role="tabs">
    <button class="tab-btn active" type="button" data-tab-btn="unpacking">接驳区排程</button>
    <button class="tab-btn" type="button" data-tab-btn="retention">暂存间排程</button>
  </div>

  <section class="card section">
    <h3>手动排程</h3>
    <form data-form="manual-schedule">
      <div class="form-grid">
        <div class="form-field">
          <label>任务编号</label>
          <select
            name="task_code"
            data-task-select
            data-placeholder="请选择已接收任务"
            data-empty-placeholder="暂无已接收任务"
          >
            <option value="">请选择已接收任务</option>
          </select>
        </div>
        <div class="form-field">
          <label>实验室</label>
          <select
            name="device"
            data-schedule-lab-select
            data-placeholder="请选择实验室"
            data-empty-placeholder="请先选择任务"
            data-custom-label="其他/自定义"
          >
            <option value="">请选择实验室</option>
          </select>
        </div>
        <div class="form-field">
          <label>排程日期</label>
          <input type="date" name="schedule_date" />
        </div>
        <div class="form-field">
          <label>时段</label>
          <select name="time_slot" data-time-slot>
            <option value="morning">上午（08:00-11:30）</option>
            <option value="afternoon">下午（13:30-17:00）</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div class="form-field is-hidden" data-retention-now>
          <label>当前时间</label>
          <div class="retention-now" data-retention-now-value>--:--</div>
        </div>
        <div class="form-field is-hidden" data-custom-time>
          <label>开始时间</label>
          <input type="time" name="custom_start" />
        </div>
        <div class="form-field is-hidden" data-custom-time>
          <label>结束时间</label>
          <input type="time" name="custom_end" />
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#" data-action="manual-schedule-run">确认排程</a>
        <a class="action-btn secondary" href="#" data-action="manual-schedule-reset">清空</a>
      </div>
      <div class="form-alert is-hidden" data-schedule-warning></div>
    </form>
  </section>

  <section class="card section is-hidden" data-retention-internal>
    <div class="retention-internal-header">
      <div>
        <h3>暂存间内部排程单</h3>
        <div class="muted">仅显示未分配实验室的任务</div>
      </div>
      <div class="retention-internal-count">
        <div class="muted">待分配</div>
        <div class="kpi" id="retention-internal-count">0</div>
      </div>
    </div>
    <table class="table" id="retention-internal-table" data-sortable>
      <thead>
        <tr>
          <th data-sort>任务编号</th>
          <th data-sort>试验类型</th>
          <th data-sort>暂存时间</th>
          <th>已等待</th>
        </tr>
      </thead>
      <tbody id="retention-internal-table-body"></tbody>
    </table>
  </section>

  <section class="card section">
    <h3>设备空闲排程（上午/下午）</h3>
    <div class="gantt-wrap">
      <table
        class="gantt"
        id="gantt-table"
        data-days="3"
        data-label-am="上午 08:00-11:30"
        data-label-pm="下午 13:30-17:00"
        data-label-idle="空闲"
        data-label-conflict="冲突"
        data-label-empty="暂无设备"
      >
        <thead id="gantt-head">
          <tr id="gantt-day-row">
            <th rowspan="2" class="gantt-sticky" data-static="1">设备</th>
          </tr>
          <tr id="gantt-slot-row"></tr>
        </thead>
        <tbody id="gantt-body"></tbody>
      </table>
    </div>
  </section>

  <section class="grid cols-3 section">
    <div class="card">
      <h3>下一次排程提示</h3>
      <div class="muted">基于设备空闲与样品到样</div>
      <div class="kpi" id="schedule-next-auto">--:--</div>
    </div>
    <div class="card">
      <h3>冲突提醒</h3>
      <div class="muted">待处理</div>
      <div class="kpi" id="schedule-conflict-count">0</div>
    </div>
    <div class="card">
      <h3>变更申请</h3>
      <div class="muted">24小时内</div>
      <div class="kpi" id="schedule-change-count">0</div>
    </div>
  </section>

  <section class="card section">
    <h3>排程清单</h3>
    <div class="toolbar">
      <input class="search-input" data-filter-input="#schedule-table" placeholder="筛选任务/设备/时间" />
    </div>
    <table class="table" id="schedule-table" data-sortable>
      <thead>
        <tr>
          <th data-sort>任务</th>
          <th data-sort>设备</th>
          <th data-sort>开始时间</th>
          <th data-sort>结束时间</th>
          <th data-sort>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="schedule-table-body"></tbody>
    </table>
  </section>

  <section class="card section">
    <h3>待解决冲突</h3>
    <div class="toolbar">
      <input class="search-input" data-filter-input="#conflict-table" placeholder="筛选任务/设备/冲突类型" />
    </div>
    <table class="table" id="conflict-table" data-sortable>
      <thead>
        <tr>
          <th data-sort>任务</th>
          <th data-sort>设备</th>
          <th data-sort>冲突类型</th>
          <th data-sort>影响</th>
          <th>建议</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="conflict-table-body"></tbody>
    </table>
  </section>

  <div class="drawer" id="schedule-drawer">
    <div class="modal-backdrop" data-drawer-close="schedule-drawer"></div>
    <div class="drawer-content">
      <div class="drawer-header">
        <strong>排程编辑</strong>
        <button class="drawer-close" data-drawer-close="schedule-drawer">关闭</button>
      </div>
      <form class="form-grid" data-form="schedule-edit">
        <div class="form-field">
          <label>任务编号</label>
          <input type="text" name="task_code" readonly />
        </div>
        <div class="form-field">
          <label>实验室</label>
          <select
            name="device"
            data-schedule-edit-lab
            data-placeholder="请选择实验室"
            data-empty-placeholder="暂无实验室"
            data-custom-label="其他/自定义"
          >
            <option value="">请选择实验室</option>
          </select>
        </div>
        <div class="form-field">
          <label>排程日期</label>
          <input type="date" name="schedule_date" />
        </div>
        <div class="form-field">
          <label>时段</label>
          <select name="time_slot" data-edit-time-slot>
            <option value="morning">上午（08:00-11:30）</option>
            <option value="afternoon">下午（13:30-17:00）</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div class="form-field is-hidden" data-edit-custom-time>
          <label>开始时间</label>
          <input type="time" name="custom_start" />
        </div>
        <div class="form-field is-hidden" data-edit-custom-time>
          <label>结束时间</label>
          <input type="time" name="custom_end" />
        </div>
        <div class="form-actions" style="grid-column: 1 / -1;">
          <a class="action-btn" href="#" data-action="schedule-update">保存修改</a>
          <a class="action-btn secondary" href="#" data-action="schedule-delete">删除排程</a>
        </div>
        <div class="form-alert is-hidden" data-schedule-edit-warning style="grid-column: 1 / -1;"></div>
      </form>
    </div>
  </div>
</template>

