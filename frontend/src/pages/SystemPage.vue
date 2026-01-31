<template>
  <section class="grid cols-3 stagger">
    <div class="card">
      <div class="muted">用户</div>
      <div class="kpi">42</div>
      <div class="muted">本周活跃</div>
    </div>
    <div class="card">
      <div class="muted">班次</div>
      <div class="kpi">3</div>
      <div class="muted">白班/中班/夜班</div>
    </div>
    <div class="card">
      <div class="muted">角色权限</div>
      <div class="kpi">6</div>
      <div class="muted">核心角色</div>
    </div>
  </section>

  <section class="card section">
    <h3>角色权限矩阵</h3>
    <div class="toolbar">
      <input class="search-input" data-filter-input="#role-table" placeholder="筛选角色/权限" />
      <a class="action-btn" href="#" data-modal-open="role-modal">新增角色</a>
    </div>
    <table class="table" id="role-table" data-sortable>
      <thead>
        <tr>
          <th data-sort>角色</th>
          <th data-sort>范围</th>
          <th data-sort>关键权限</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>排程员</td>
          <td>任务 + 排程</td>
          <td>创建、改排</td>
          <td><a class="action-link" href="#" data-drawer-open="role-drawer">编辑</a></td>
        </tr>
        <tr>
          <td>试验主管</td>
          <td>过程 + 数据</td>
          <td>审批、数据锁定</td>
          <td><a class="action-link" href="#" data-drawer-open="role-drawer">编辑</a></td>
        </tr>
        <tr>
          <td>设备工程师</td>
          <td>设备</td>
          <td>校准、维护</td>
          <td><a class="action-link" href="#" data-drawer-open="role-drawer">编辑</a></td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card section">
    <h3>基础配置</h3>
    <div class="form-grid">
      <div class="form-field">
        <label>班次配置</label>
        <input type="text" placeholder="白班 08:00-16:00" />
      </div>
      <div class="form-field">
        <label>数据保留周期</label>
        <input type="text" placeholder="例如：36 个月" />
      </div>
      <div class="form-field">
        <label>通知方式</label>
        <select>
          <option>站内通知</option>
          <option>短信</option>
          <option>邮件</option>
        </select>
      </div>
    </div>
  </section>

  <div class="modal" id="role-modal">
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <div class="modal-header">
        <strong>新增角色</strong>
        <button class="modal-close" data-modal-close="role-modal">关闭</button>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>角色名称</label>
          <input type="text" placeholder="例如：数据审核员" />
        </div>
        <div class="form-field">
          <label>权限范围</label>
          <input type="text" placeholder="过程 + 数据" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>关键权限</label>
          <textarea placeholder="列出关键操作权限"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#">保存</a>
        <a class="action-btn secondary" href="#">取消</a>
      </div>
    </div>
  </div>

  <div class="drawer" id="role-drawer">
    <div class="modal-backdrop" data-drawer-close="role-drawer"></div>
    <div class="drawer-content">
      <div class="drawer-header">
        <strong>角色详情</strong>
        <button class="drawer-close" data-drawer-close="role-drawer">关闭</button>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>角色名称</label>
          <input type="text" placeholder="排程员" />
        </div>
        <div class="form-field">
          <label>范围</label>
          <input type="text" placeholder="任务 + 排程" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>权限说明</label>
          <textarea placeholder="更新权限描述"></textarea>
        </div>
      </div>
    </div>
  </div>
</template>
