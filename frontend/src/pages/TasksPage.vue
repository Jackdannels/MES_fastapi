<template>
  <section class="grid cols-3 stagger">
    <div class="card">
      <div class="muted">外部委托</div>
      <div class="kpi" id="task-external-count">0</div>
      <div class="muted">等待到样</div>
    </div>
    <div class="card">
      <div class="muted">内部新增</div>
      <div class="kpi" id="task-internal-count">0</div>
      <div class="muted">研发/质控</div>
    </div>
    <div class="card">
      <div class="muted">待排程</div>
      <div class="kpi" id="task-unscheduled-count">0</div>
      <div class="muted">需设备空闲</div>
    </div>
  </section>

  <section class="card section">
    <h3>总任务清单</h3>
    <div class="toolbar">
      <input class="search-input" id="task-list-search" placeholder="筛选任务编号/客户/设备" />
      <select class="search-input" id="task-list-filter-test-type">
        <option value="">全部试验类型</option>
      </select>
      <select class="search-input" id="task-list-filter-status">
        <option value="">全部状态</option>
      </select>
      <div class="task-list-pagination" id="task-list-pagination"></div>
    </div>
    <table class="table" id="task-table" data-sortable>
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort>任务编号</th>
          <th data-sort>来源</th>
          <th data-sort>样品</th>
          <th data-sort>实验类型</th>
          <th data-sort>设备要求</th>
          <th data-sort>期望完成</th>
          <th data-sort>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="task-table-body"></tbody>
    </table>
  </section>

  <div class="modal" id="task-intake-modal">
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <div class="modal-header">
        <strong>手动添加任务</strong>
        <button class="modal-close" data-modal-close="task-intake-modal">关闭</button>
      </div>
      <form data-form="task-intake">
        <div class="form-grid">
          <div class="form-field">
            <label>任务来源</label>
            <select name="source">
              <option>外部委托</option>
              <option>内部新增</option>
            </select>
          </div>
          <div class="form-field">
            <label>任务名称</label>
            <input type="text" name="name" placeholder="例如：来料检测-批次A" />
          </div>
          <div class="form-field">
            <label>任务编号</label>
            <input type="text" name="code" placeholder="根据试验类型自动生成" readonly />
          </div>
          <div class="form-field">
            <label>委托单位/部门</label>
            <input type="text" name="client" placeholder="客户或内部部门" value="内部部门" />
          </div>
          <div class="form-field">
            <label>联系人</label>
            <input type="text" name="contact" placeholder="姓名" />
          </div>
          <div class="form-field">
            <label>联系方式</label>
            <input type="text" name="contact_info" placeholder="电话/邮箱" />
          </div>
          <div class="form-field">
            <label>优先级</label>
            <select name="priority">
              <option>高</option>
              <option>中</option>
              <option>低</option>
            </select>
          </div>
          <div class="form-field">
            <label>样品数量</label>
            <input type="number" name="sample_count" placeholder="例如：12" />
          </div>
          <div class="form-field">
            <label>样品类型</label>
            <input type="text" name="sample_type" placeholder="例如：固体/液体/粉末" />
          </div>
          <div class="form-field">
            <label>试验类型</label>
            <select name="test_type" data-test-type-select>
              <option value="">请选择试验类型</option>
            </select>
          </div>
          <div class="form-field">
            <label>期望完成时间</label>
            <input type="datetime-local" name="due_at" />
          </div>
          <div class="form-field">
            <label>到样时间</label>
            <input type="datetime-local" name="arrival_at" />
          </div>
          <div class="form-field">
            <label>必需设备/能力</label>
            <input type="text" name="required_device" placeholder="例如：HPLC / ICP" />
          </div>
          <div class="form-field">
            <label>环境/特殊条件</label>
            <input type="text" name="conditions" placeholder="温湿度/避光等" />
          </div>
          <div class="form-field">
            <label>附件</label>
            <input type="text" name="attachment" placeholder="上传报告或规范编号" />
            <div class="helper">可关联委托书、规范、SOP</div>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>备注</label>
            <textarea name="remark" placeholder="补充说明与注意事项"></textarea>
          </div>
        </div>
        <div class="form-actions">
          <a class="action-btn" href="#" data-action="task-submit">提交受理</a>
          <a class="action-btn secondary" href="#" data-action="task-draft">保存草稿</a>
        </div>
        <div class="form-alert is-hidden" data-task-warning></div>
      </form>
    </div>
  </div>

  <div class="drawer" id="task-drawer">
    <div class="modal-backdrop" data-drawer-close="task-drawer"></div>
    <div class="drawer-content">
      <div class="drawer-header">
        <strong>任务详情</strong>
        <button class="drawer-close" data-drawer-close="task-drawer">关闭</button>
      </div>
      <form class="form-grid" data-form="task-edit">
        <div class="form-field">
          <label>任务编号</label>
          <input type="text" name="code" readonly />
        </div>
        <div class="form-field">
          <label>任务名称</label>
          <input type="text" name="name" placeholder="例如：来料检测-批次A" />
        </div>
        <div class="form-field">
          <label>来源</label>
          <select name="source">
            <option>外部委托</option>
            <option>内部新增</option>
          </select>
        </div>
        <div class="form-field">
          <label>优先级</label>
          <select name="priority">
            <option>高</option>
            <option>中</option>
            <option>低</option>
          </select>
        </div>
        <div class="form-field">
          <label>样品数量</label>
          <input type="number" name="sample_count" placeholder="例如：12" />
        </div>
        <div class="form-field">
          <label>样品类型</label>
          <input type="text" name="sample_type" placeholder="例如：固体/液体/粉末" />
        </div>
        <div class="form-field">
          <label>试验类型</label>
          <select name="test_type" data-test-type-select>
            <option value="">请选择试验类型</option>
          </select>
        </div>
        <div class="form-field">
          <label>期望完成时间</label>
          <input type="datetime-local" name="due_at" />
        </div>
        <div class="form-field">
          <label>到样时间</label>
          <input type="datetime-local" name="arrival_at" />
        </div>
        <div class="form-field">
          <label>必需设备/能力</label>
          <input type="text" name="required_device" placeholder="例如：HPLC / ICP" />
        </div>
        <div class="form-field">
          <label>状态</label>
          <select name="status">
            <option>待排程</option>
            <option>已排程</option>
            <option>实验中</option>
            <option>实验已经完成</option>
            <option>暂存间排放</option>
          </select>
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>备注</label>
          <textarea name="remark" placeholder="更新说明"></textarea>
        </div>
      </form>
      <div class="form-actions">
        <a class="action-btn" href="#" data-action="task-update">保存修改</a>
        <a class="action-btn secondary" href="#" data-action="task-delete">删除任务</a>
      </div>
      <div class="form-alert is-hidden" data-task-edit-warning></div>
    </div>
  </div>
</template>
