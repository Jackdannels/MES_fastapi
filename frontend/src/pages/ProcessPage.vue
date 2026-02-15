<template>
  <section class="grid cols-3 stagger">
    <div class="card">
      <div class="muted">活跃 SOP</div>
      <div class="kpi">9</div>
      <div class="muted">可执行</div>
    </div>
    <div class="card">
      <div class="muted">执行中</div>
      <div class="kpi">5</div>
      <div class="muted">覆盖 3 个实验室</div>
    </div>
    <div class="card">
      <div class="muted">异常/偏差</div>
      <div class="kpi">1</div>
      <div class="muted">待复核</div>
    </div>
  </section>

  <section class="card section">
    <h3>试验计划与步骤</h3>
    <form>
      <div class="form-grid">
        <div class="form-field">
          <label>任务编号</label>
          <input type="text" placeholder="例如：WQ-2024-031" />
        </div>
        <div class="form-field">
          <label>SOP 模板</label>
          <select>
            <option>重金属检测 SOP</option>
            <option>含量检测 SOP</option>
            <option>稳定性 SOP</option>
          </select>
        </div>
        <div class="form-field">
          <label>负责人员</label>
          <input type="text" placeholder="姓名" />
        </div>
        <div class="form-field">
          <label>设备</label>
          <input type="text" placeholder="HPLC-03 / ICP-07" />
        </div>
        <div class="form-field">
          <label>计划开始</label>
          <input type="datetime-local" />
        </div>
        <div class="form-field">
          <label>计划结束</label>
          <input type="datetime-local" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1;">
          <label>关键步骤</label>
          <textarea placeholder="步骤1：样品前处理；步骤2：设备预热；步骤3：开始采集"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <a class="action-btn" href="#">开始执行</a>
        <a class="action-btn secondary" href="#">保存计划</a>
      </div>
    </form>
  </section>

  <section class="card section">
    <h3>过程记录与异常</h3>
    <table class="table">
      <thead>
        <tr>
          <th>序号</th>
          <th>时间</th>
          <th>步骤</th>
          <th>执行人</th>
          <th>状态</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>09:10</td>
          <td>样品前处理</td>
          <td>Lab-02</td>
          <td><span class="status">完成</span></td>
          <td>样品标签核对完成</td>
        </tr>
        <tr>
          <td>2</td>
          <td>10:05</td>
          <td>设备预热</td>
          <td>Lab-05</td>
          <td><span class="status">完成</span></td>
          <td>温度稳定</td>
        </tr>
        <tr>
          <td>3</td>
          <td>10:20</td>
          <td>开始采集</td>
          <td>Lab-05</td>
          <td><span class="status warn">进行中</span></td>
          <td>Modbus 流量正常</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="card section">
    <h3>异常与复测处理</h3>
    <div class="form-grid">
      <div class="form-field">
        <label>异常类型</label>
        <select>
          <option>设备异常</option>
          <option>样品异常</option>
          <option>数据异常</option>
          <option>操作偏差</option>
        </select>
      </div>
      <div class="form-field">
        <label>处理方式</label>
        <select>
          <option>复测</option>
          <option>暂停并报修</option>
          <option>重新制备</option>
          <option>记录并继续</option>
        </select>
      </div>
      <div class="form-field" style="grid-column: 1 / -1;">
        <label>处理说明</label>
        <textarea placeholder="描述异常原因与处理结果"></textarea>
      </div>
    </div>
  </section>
</template>
