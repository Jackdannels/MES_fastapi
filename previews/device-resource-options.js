// Isolated UI prototype. No API calls, storage writes, or production workflow mutations.
const $ = (selector) => document.querySelector(selector);
const resources = [{ key: 'tray', name: '托盘', used: '已用托盘', capacity: 10 }, { key: 'salt', name: '盐雾', used: '已用盐量', capacity: 100 }, { key: 'mold', name: '霉菌', used: '已用菌体', capacity: 100 }];
const designs = {
  a: ['01 / 03', '一眼看全设备与余量', '在设备统计下新增三张资源卡，设备列表保持完整宽度；适合日常查看与快速补充。'],
  b: ['02 / 03', '设备在左，资源常驻右侧', '借鉴 6 号屏的余量侧栏，集中查看、补充与预警；适合宽屏中控，设备表可用宽度会减少。'],
  c: ['03 / 03', '耗材操作独立，设备管理清晰', '顶部保留简明余量条，详细卡片与补充记录放入独立页签；适合高频耗材管理，查看明细需切换页签。'],
};
const deviceRows = [
  ['冲击一室','冲击试验','冲击试验'],['冲击二室','冲击试验-2','冲击试验'],['四综合实验室','四综合试验系统','四综合试验'],
  ['振动一室','振动试验系统-1','振动试验'],['振动二室','振动试验系统-2','振动试验'],['温度冲击一室','温度冲击系统-1','温度冲击试验'],
  ['温度冲击二室','温度冲击系统-2','温度冲击试验'],['盐雾试验室','盐雾试验箱','盐雾试验'],['霉菌试验室','霉菌培养箱','霉菌试验'],
  ['高低温湿热一室','高低温湿热系统','高低温湿热试验'],['高低温湿热二室','高低温湿热系统-2','高低温湿热试验'],
];
let option = ['a','b','c'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'a';
let currentTab = 'materials';
let stock = {};
let initial = {};
let records = [];
let activeResource;
let trigger;
let toastTimer;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function status(resource) {
  const remaining = stock[resource.key];
  return remaining === 0 ? ['empty','已耗尽'] : remaining <= resource.capacity * .1 ? ['low','余量偏低'] : ['', '余量充足'];
}
function resourceCard(resource, mirror = false) {
  const [tone,label] = status(resource);
  const remaining = stock[resource.key];
  const used = resource.capacity - initial[resource.key];
  const added = records.filter(record => record.key === resource.key).reduce((sum,record) => sum+record.amount,0);
  return `<article class="resource-card ${tone}" data-resource="${resource.key}"><div class="resource-top"><h3>${resource.name}剩余</h3><span class="badge">${label}</span></div><div class="quantity"><strong>${remaining}</strong><span>${resource.key === 'tray' ? '/ 10 个' : '基准 100 · 演示数量'}</span></div><div class="meter" aria-hidden="true">${Array.from({length:10},(_,i)=>`<i class="${i < Math.ceil(Math.min(1,remaining/resource.capacity)*10) ? 'on' : ''}"></i>`).join('')}</div><div class="resource-bottom"><small>${resource.used} ${used}${added ? ` · 已补充 ${added}` : ''}</small>${mirror ? '' : resource.key === 'tray' ? '<span class="muted">系统自动统计 · 只读</span>' : `<button data-replenish="${resource.key}">+ 补充${resource.name}</button>`}</div></article>`;
}
function resourceSection(side = false) {
  return `<section class="panel resource-section"><div class="panel-head"><div><div class="section-caption"><h2>资源余量</h2><span class="badge muted-badge">与 6 号屏同源 · 演示</span></div>${side ? '<div class="sub">余量与补充操作集中在此</div>' : ''}</div><button class="link" data-records>补充记录</button></div><div class="resource-grid">${resources.map(r=>resourceCard(r)).join('')}</div>${side ? '<p class="side-sub">托盘占用自动更新；补充仅面向盐雾与霉菌。</p>' : ''}<button class="link" data-mirror>查看 6 号屏联动演示 ↗</button></section>`;
}
function tableRows(query = '') {
  return deviceRows.map((row,i)=>({row,i})).filter(({row})=>row.join(' ').includes(query)||'空闲'.includes(query)).map(({row,i})=>`<tr><td>${i+1}</td><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td><span class="status">空闲</span></td><td>${row[0]}</td><td>/</td><td>/</td><td class="row-actions"><span>编辑</span><span>维保计划</span></td></tr>`).join('') || '<tr><td colspan="9">没有匹配的设备</td></tr>';
}
function registry() {
  return `<section class="panel registry"><div class="panel-head"><h2>设备列表</h2><span class="muted">11 台设备</span></div><div class="toolbar"><input id="device-search" aria-label="筛选设备、状态或位置" placeholder="筛选设备 / 状态 / 位置"><span class="muted">现有设备功能保持不变</span></div><div class="table-wrap" tabindex="0" aria-label="设备列表，可横向滚动"><table><thead><tr>${['序号','设备编号','设备名称','试验类型','状态','位置','下次维保','维保计划结束时间','操作'].map(s=>`<th scope="col">${s}</th>`).join('')}</tr></thead><tbody id="device-body">${tableRows()}</tbody></table></div><div class="registry-footer"><span>共 11 台 · 设备示意数据</span><span>原有操作仅展示</span></div></section>`;
}
function recordsHtml() {
  return records.length ? records.map(record=>`<div class="record"><div><strong>${record.name}</strong><small>${record.time}</small></div><div>${record.before} → ${record.after}<small>${escapeHtml(record.remark || '未填写备注')} · 演示操作员</small></div><b>+ ${record.amount}</b></div>`).join('') : '<div class="records-empty">暂无演示补充记录<br><small>完成一次补充后，这里会显示数量、前后余量与备注。</small></div>';
}
function render() {
  document.querySelectorAll('[data-option]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.option===option)));
  const design=designs[option];
  $('#option-number').textContent=design[0]; $('#option-title').textContent=design[1]; $('#option-description').textContent=design[2];
  $('#choose').textContent=`选择方案 ${option.toUpperCase()}`;
  if(option==='a') $('#workspace').innerHTML=resourceSection()+registry();
  if(option==='b') $('#workspace').innerHTML=`<div class="layout-b">${registry()}${resourceSection(true)}</div>`;
  if(option==='c') {
    const warningCount=resources.filter(r=>r.key!=='tray' && stock[r.key]<=10).length;
    $('#workspace').innerHTML=`<div class="mini-summary">${resources.map(r=>`<span>${r.name}剩余<strong class="${stock[r.key]<=r.capacity*.1?'warn-num':''}">${stock[r.key]}</strong></span>`).join('')}<small>与 6 号屏同源 · 演示</small><button class="link" data-mirror>查看联动 ↗</button></div><nav class="tabs" aria-label="设备资源分类"><button data-tab="devices" aria-pressed="${currentTab==='devices'}">设备台账 <span class="muted">11</span></button><button data-tab="materials" aria-pressed="${currentTab==='materials'}">耗材与托盘${warningCount?`<span class="count-badge">${warningCount} 项提醒</span>`:''}</button></nav>${currentTab==='devices'?registry():`<section class="panel management"><div class="panel-head"><div><h2>耗材与托盘</h2><div class="sub">统一余量视图 · 盐雾 / 霉菌支持补充登记</div></div><span class="badge muted-badge">仅预览数据</span></div><div class="resource-grid">${resources.map(r=>resourceCard(r)).join('')}</div><div class="records-block"><h3>最近补充记录 <span class="muted">/ 本次演示</span></h3>${recordsHtml()}</div></section>`}`;
  }
  $('#records-content').innerHTML=recordsHtml();
  $('#mirror-content').innerHTML=resources.map(r=>resourceCard(r,true)).join('');
}
function reset() {
  const scenario=$('#scenario').value;
  stock=scenario==='full'?{tray:10,salt:100,mold:100}:scenario==='empty'?{tray:3,salt:0,mold:0}:{tray:7,salt:8,mold:64};
  initial={...stock}; records=[]; render();
}
function notify(message) {
  clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('show');
  toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);
}
function validAmount() { const amount=Number($('#amount').value); return Number.isSafeInteger(amount)&&amount>0&&amount<=10000; }
function updateAmount(showError=false) {
  const valid=validAmount(); $('#after-value').textContent=valid?stock[activeResource.key]+Number($('#amount').value):'—';
  if(showError){$('#amount-error').textContent=valid?'':'请输入 1–10,000 之间的正整数。';$('#amount').setAttribute('aria-invalid',String(!valid));}
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button)return;
  if(button.dataset.option){option=button.dataset.option;history.replaceState(null,'',`#${option}`);render();}
  if(button.dataset.tab){currentTab=button.dataset.tab;render();}
  if(button.dataset.replenish){
    activeResource=resources.find(r=>r.key===button.dataset.replenish); trigger=button.dataset.replenish;
    $('#replenish-form').reset();$('#amount-error').textContent='';$('#amount').removeAttribute('aria-invalid');
    $('#dialog-title').textContent=`补充${activeResource.name}`;$('#before-value').textContent=stock[activeResource.key];$('#after-value').textContent='—';
    $('#replenish-dialog').showModal();$('#amount').focus();
  }
  if(button.dataset.amount){$('#amount').value=button.dataset.amount;updateAmount(true);}
  if(button.hasAttribute('data-records'))$('#records-dialog').showModal();
  if(button.hasAttribute('data-mirror'))$('#mirror-dialog').showModal();
  if(button.classList.contains('close-dialog'))$('#replenish-dialog').close();
  if(button.classList.contains('close-records'))$('#records-dialog').close();
  if(button.classList.contains('close-mirror'))$('#mirror-dialog').close();
});
$('#amount').addEventListener('input',()=>updateAmount());$('#amount').addEventListener('blur',()=>updateAmount(true));
$('#replenish-form').addEventListener('submit',event=>{
  event.preventDefault();updateAmount(true);if(!validAmount()){$('#amount').focus();return;}
  const amount=Number($('#amount').value),before=stock[activeResource.key];stock[activeResource.key]+=amount;
  records.unshift({key:activeResource.key,name:activeResource.name,amount,before,after:stock[activeResource.key],remark:$('#remark').value.trim(),time:new Date().toLocaleTimeString('zh-CN',{hour12:false})});
  $('#replenish-dialog').close();render();document.querySelector(`[data-replenish="${trigger}"]`)?.focus();
  notify(`${activeResource.name}已模拟补充 ${amount}，当前余量 ${stock[activeResource.key]}；6 号屏联动演示已更新。`);
});
$('#workspace').addEventListener('input',event=>{if(event.target.id==='device-search')$('#device-body').innerHTML=tableRows(event.target.value.trim());});
$('#scenario').addEventListener('change',reset);$('#reset').addEventListener('click',()=>{reset();notify('演示已重置，真实数据未变更。');});
$('#choose').addEventListener('click',()=>notify(`你选中了方案 ${option.toUpperCase()}。请在对话中告诉我，确认后再接入正式数据。`));
window.addEventListener('hashchange',()=>{if(designs[location.hash.slice(1)]){option=location.hash.slice(1);render();}});
reset();
