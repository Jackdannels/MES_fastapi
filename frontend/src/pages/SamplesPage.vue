<template>
  <section class="card section">
    <h3>样品登记</h3>
    <form data-form="sample-intake">
      <div class="form-grid">
        <div class="form-field">
          <label>样品编号</label>
          <input type="text" name="code" readonly placeholder="选择关联任务后自动生成样品编号" />
          <div class="helper">按任务号自动生成并绑定，例如：SZH-2024-003-SP-001</div>
        </div>
        <div class="form-field">
          <label>关联任务</label>
          <select
            name="task_code"
            data-sample-task-select="intake"
            data-placeholder="请选择任务"
            data-empty-placeholder="暂无任务"
          >
            <option value="">请选择任务</option>
          </select>
        </div>
        <div class="form-field">
          <label>样品类型</label>
          <input type="text" name="sample_type" placeholder="固体/液体/粉末" />
        </div>
        <div class="form-field">
          <label>批次/批号</label>
          <input type="text" name="batch_no" placeholder="批次号" />
        </div>
        <div class="form-field">
          <label>到样时间</label>
          <input type="datetime-local" name="arrival_at" />
        </div>
        <div class="form-field">
          <label>数量</label>
          <input type="number" name="quantity" placeholder="例如：12" />
        </div>
        <div class="form-field">
          <label>保存条件</label>
          <input type="text" name="storage_condition" placeholder="常温/冷藏/避光" />
        </div>
        <div class="form-field">
          <label>标签/条码</label>
          <input type="text" name="barcode" placeholder="扫描或输入条码" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>备注</label>
          <textarea name="remark" placeholder="样品状态与特殊说明"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#" data-action="sample-submit">确认登记</a>
        <a class="action-btn secondary" href="#" data-action="sample-draft">保存草稿</a>
      </div>
      <div class="form-alert is-hidden" data-sample-warning></div>
    </form>
  </section>

  <section class="card section">
    <h3>样品流程管理</h3>
    <div class="sample-process-layout">
      <div>
        <div class="form-grid" data-form="sample-task-process">
          <div class="form-field">
            <label>选择任务</label>
            <select
              name="task_code"
              data-sample-task-select="summary"
              data-placeholder="请选择任务"
              data-empty-placeholder="暂无任务"
            >
              <option value="">请选择任务</option>
            </select>
          </div>
          <div class="form-field">
            <label>样品数量</label>
            <div class="kpi" id="sample-task-count">0</div>
            <div class="helper" id="sample-task-count-hint">请选择任务后查看样品数量与样品编号。</div>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>样品编号</label>
            <textarea
              class="sample-codes-input"
              id="sample-task-codes"
              name="codes"
              readonly
              placeholder="选择任务后按任务号自动生成并绑定样品编号"
            ></textarea>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>样品分装（每行一个托盘）</label>
            <textarea
              id="sample-task-tray-plan"
              name="tray_plan"
              placeholder="格式：样品编号,托盘数量；例如：SZH-2026-003-SP-001,4"
            ></textarea>
            <div class="helper">
              托盘编号会自动按样品编号生成（如：SZH-2026-003-SP-001-TP-001）。同一样品可填写多行分成多个托盘，单个托盘只允许一个样品。
            </div>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>托盘编号预览</label>
            <textarea
              class="sample-codes-input"
              id="sample-task-tray-preview"
              name="tray_preview"
              readonly
              placeholder="完成分装后将显示托盘编号与托盘数量"
            ></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button class="action-btn" type="button" data-action="sample-task-store">确认入库</button>
        </div>
        <div class="form-alert is-hidden" data-sample-process-warning></div>
      </div>
      <div class="sample-flow-card">
        <div class="sample-flow-title">统一样品流程图</div>
        <div class="sample-flow-status" id="sample-flow-current">当前状态：未选择任务</div>
        <ol class="sample-flow-unified" id="sample-flow-unified">
          <li data-flow-step="0">运输中</li>
          <li data-flow-step="1">到货</li>
          <li data-flow-step="2">到达实验间</li>
          <li data-flow-step="3">实验准备就绪</li>
          <li data-flow-step="4">实验完成</li>
          <li data-flow-step="5">放置暂存间</li>
          <li data-flow-step="6">厂家收回</li>
        </ol>
      </div>
    </div>
  </section>

  <div class="tabs section" data-tab-group="samples" data-tab-role="tabs">
    <button class="tab-btn active" type="button" data-tab-btn="sample-flow">样品流转</button>
    <button class="tab-btn" type="button" data-tab-btn="sample-staging">暂存间</button>
  </div>

  <section class="card section" data-tab-panel="sample-flow" data-tab-group="samples">
    <h3>样品流转与状态</h3>
    <div class="toolbar">
      <input class="search-input" id="sample-list-search" placeholder="筛选任务/样品/位置/状态" />
      <select class="search-input" id="sample-list-filter-task">
        <option value="">全部任务</option>
      </select>
      <select class="search-input" id="sample-list-filter-status">
        <option value="">全部状态</option>
      </select>
      <a class="action-btn" href="#" data-modal-open="sample-modal">批量入库</a>
      <div class="task-list-pagination" id="sample-list-pagination"></div>
    </div>
    <table class="table" id="sample-table" data-sortable>
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort>任务</th>
          <th data-sort>样品编号</th>
          <th data-sort>托盘数</th>
          <th data-sort>当前位置</th>
          <th data-sort>责任人</th>
          <th data-sort>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="sample-table-body"></tbody>
    </table>
  </section>

  <section class="card section is-hidden" data-tab-panel="sample-staging" data-tab-group="samples">
    <h3>暂存间</h3>
    <div class="toolbar">
      <div class="muted">暂存间未试验样品 <span id="staging-count">0</span></div>
      <input class="search-input" data-filter-input="#staging-table" placeholder="筛选样品/任务/状态" />
    </div>
    <table class="table" id="staging-table" data-sortable>
      <thead>
        <tr>
          <th>序号</th>
          <th data-sort>样品编号</th>
          <th data-sort>任务</th>
          <th data-sort>当前位置</th>
          <th data-sort>状态</th>
          <th data-sort>责任人</th>
        </tr>
      </thead>
      <tbody id="staging-table-body"></tbody>
    </table>
    <div class="form-grid section" data-form="staging-dispatch">
      <div class="form-field">
        <label>派发样品</label>
        <textarea name="codes" placeholder="输入或扫描样品编号"></textarea>
      </div>
      <div class="form-field">
        <label>目标实验室</label>
        <select name="target_lab" data-test-lab-select>
          <option value="">请选择实验室</option>
        </select>
      </div>
      <div class="form-field">
        <label>责任人</label>
        <input type="text" name="owner" placeholder="负责人姓名" />
      </div>
    </div>
    <div class="form-actions">
      <a class="action-btn" href="#" data-action="staging-dispatch">派发至实验室</a>
      <a class="action-btn secondary" href="#" data-action="staging-reset">清空输入</a>
    </div>
    <div class="form-alert is-hidden" data-staging-warning></div>
  </section>

  <section class="card section">
    <h3>样品全生命周期追踪</h3>
    <form data-form="sample-trace">
      <div class="form-grid">
        <div class="form-field">
          <label>试验序号</label>
          <input type="text" name="task_code" placeholder="例如：SZH-2024-003" />
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#" data-action="sample-trace-run">查询</a>
        <a class="action-btn secondary" href="#" data-action="sample-trace-reset">清空</a>
      </div>
    </form>
    <div class="muted" id="sample-trace-summary">请输入试验序号查询样品全生命周期。</div>
    <div class="timeline" id="sample-trace-timeline"></div>
  </section>

  <div class="modal" id="sample-modal">
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <div class="modal-header">
        <strong>批量入库</strong>
        <button class="modal-close" data-modal-close="sample-modal">关闭</button>
      </div>
      <div class="form-grid" data-form="sample-batch">
        <div class="form-field">
          <label>入库位置</label>
          <select name="location" data-lab-select>
            <option value="">请选择实验室</option>
          </select>
        </div>
        <div class="form-field">
          <label>责任人</label>
          <input type="text" name="owner" placeholder="负责人姓名" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>样品列表</label>
          <textarea name="codes" placeholder="输入或扫描多个样品编号"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#" data-action="sample-batch-submit">确认入库</a>
        <a class="action-btn secondary" href="#">取消</a>
      </div>
    </div>
  </div>

  <div class="drawer" id="sample-drawer">
    <div class="modal-backdrop" data-drawer-close="sample-drawer"></div>
    <div class="drawer-content">
      <div class="drawer-header">
        <strong>样品详情</strong>
        <button class="drawer-close" data-drawer-close="sample-drawer">关闭</button>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>样品编号</label>
          <input type="text" name="code" placeholder="SP-2403-11" />
        </div>
        <div class="form-field">
          <label>状态</label>
          <select name="status">
            <option>已接收</option>
            <option>试验中</option>
            <option>已入库</option>
            <option>已处置</option>
          </select>
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>流转备注</label>
          <textarea name="remark" placeholder="更新流转信息"></textarea>
        </div>
      </div>
    </div>
  </div>
</template>
