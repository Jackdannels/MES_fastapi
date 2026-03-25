<template>
  <section class="card section">
    <h3>样品流程管理</h3>
    <div class="sample-process-layout" :class="{ 'is-compact-outbound': compactOutbound }">
      <div>
        <div class="form-grid sample-task-process-grid">
          <div class="form-field sample-task-focus-field">
            <label>选择任务</label>
            <select
              class="sample-task-focus-select"
              data-testid="samples-process-task-select"
              :value="samplesProcess.selectedTaskCode"
              @change="samplesProcess.selectTask($event.target.value)"
            >
              <option value="">{{ samplesProcess.taskOptions.length ? "请选择任务" : "暂无任务" }}</option>
              <option v-for="option in samplesProcess.taskOptions" :key="option.code" :value="option.code">
                {{ option.label }}
              </option>
            </select>
            <div class="helper sample-task-focus-hint">请选择任务后，自动加载样品数量、编号与托盘分配信息。</div>
          </div>
          <div class="form-field sample-task-count-field">
            <label>样品数量</label>
            <div class="kpi" data-testid="samples-process-count">{{ samplesProcess.trayDraft.sampleCount || 0 }}</div>
            <div class="helper">
              {{
                samplesProcess.selectedTaskCode
                  ? "已根据当前任务加载计划样品数量与托盘信息。"
                  : "请选择任务后查看样品数量与样品编号。"
              }}
            </div>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>样品编号</label>
            <textarea
              class="sample-codes-input"
              data-testid="samples-process-codes"
              readonly
              :value="samplesProcess.sampleCodesText"
              placeholder="选择任务后按任务号自动生成并绑定样品编号"
            ></textarea>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>样品分装</label>
            <div class="sample-tray-builder">
              <div class="sample-tray-source">
                <div class="sample-tray-title">可选样品</div>
                <div class="sample-tray-source-hint">
                  {{
                    samplesProcess.activeTrayIndex >= 0 && samplesProcess.trayDraft.trays[samplesProcess.activeTrayIndex]
                      ? `当前托盘：${samplesProcess.trayDraft.trays[samplesProcess.activeTrayIndex].trayCode}`
                      : "当前未选中托盘"
                  }}
                </div>
                <div class="sample-tray-source-list">
                  <button
                    v-for="sampleCode in samplesProcess.trayDraft.sampleCodes"
                    :key="sampleCode"
                    type="button"
                    class="sample-tray-chip"
                    draggable="true"
                    @dragstart="samplesProcess.startDragging(sampleCode)"
                    @click="samplesProcess.moveToActiveTray(sampleCode)"
                  >
                    {{ sampleCode }}
                  </button>
                </div>
              </div>
              <div class="sample-tray-main">
                <div class="sample-tray-toolbar">
                  <div class="sample-tray-title">托盘分装</div>
                  <label class="sample-tray-limit">
                    <span>统一上限（每托盘最多样品数）</span>
                    <input
                      data-testid="samples-process-tray-limit"
                      type="number"
                      min="1"
                      step="1"
                      :value="samplesProcess.trayDraft.maxPerTray"
                      :disabled="samplesProcess.storeLocked"
                      @change="samplesProcess.setTrayLimit($event.target.value)"
                    />
                  </label>
                  <button
                    class="action-btn secondary sample-tray-add-btn"
                    type="button"
                    data-testid="samples-process-add-tray"
                    :disabled="!samplesProcess.selectedTaskCode || samplesProcess.storeLocked"
                    @click="samplesProcess.addTray"
                  >
                    新增托盘
                  </button>
                </div>
                <div class="sample-tray-list">
                  <div
                    v-for="(tray, index) in samplesProcess.trayDraft.trays"
                    :key="tray.id || tray.trayCode || index"
                    class="sample-tray-card"
                    :class="{ 'is-active': index === samplesProcess.activeTrayIndex }"
                    :data-testid="`samples-process-tray-${index}`"
                    @click="(samplesProcess.selectProcessTray || samplesProcess.setActiveTray)(index)"
                    @dragover.prevent
                    @drop.prevent="samplesProcess.handleTrayDrop(index)"
                  >
                    <div class="sample-tray-card-head">
                      <span>{{ tray.trayCode || `托盘 #${index + 1}` }}</span>
                      <span>{{ `托盘 #${index + 1}` }}</span>
                    </div>
                    <div class="sample-tray-card-meta">已放置 {{ tray.samples.length }} / {{ samplesProcess.trayDraft.maxPerTray }}</div>
                    <div class="sample-tray-samples">
                      <span v-if="tray.samples.length === 0" class="sample-tray-empty">未分配样品</span>
                      <button
                        v-for="sampleCode in tray.samples"
                        :key="sampleCode"
                        type="button"
                        class="sample-tray-sample-tag"
                        draggable="true"
                        @dragstart.stop="samplesProcess.startDragging(sampleCode)"
                      >
                        {{ sampleCode }}
                      </button>
                    </div>
                    <div class="sample-tray-card-controls">
                      <label class="sample-tray-capacity">数量（当前放置样品数）：{{ tray.samples.length }}</label>
                      <button
                        type="button"
                        class="sample-tray-remove"
                        :data-testid="`samples-process-delete-tray-${index}`"
                        :disabled="samplesProcess.trayDraft.trays.length <= 1 || samplesProcess.storeLocked"
                        @click.stop="samplesProcess.removeTray(index)"
                      >
                        删除托盘
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="helper">默认统一上限 5、默认 1 个托盘；样品超出单盘上限时自动增盘，支持托盘间拖拽。</div>
          </div>
          <div class="form-field" style="grid-column: 1 / -1;">
            <label>托盘编号预览</label>
            <textarea
              class="sample-codes-input"
              data-testid="samples-process-tray-preview"
              readonly
              :value="samplesProcess.trayPreviewText"
              placeholder="完成分装后将显示托盘编号与托盘数量"
            ></textarea>
          </div>
        </div>
        <div class="sample-process-actions">
          <div class="form-actions">
            <button
              class="action-btn"
              type="button"
              data-testid="samples-process-store"
              :disabled="samplesProcess.storeLocked"
              @click="samplesProcess.confirmStore"
            >
              确认入库
            </button>
            <button
              class="action-btn secondary"
              type="button"
              data-testid="samples-process-print"
              :disabled="!samplesProcess.canPrint"
              @click="samplesProcess.printTrays"
            >
              编码打印
            </button>
            <button
              class="action-btn secondary"
              type="button"
              data-testid="samples-process-restore"
              :disabled="!samplesProcess.storeLocked"
              @click="samplesProcess.restoreStore"
            >
              重新入库
            </button>
          </div>
          <section v-if="showOutbound" class="sample-outbound-panel" data-testid="samples-process-outbound-panel">
            <div class="sample-outbound-panel-head">
              <div class="sample-outbound-panel-title">扫码出库</div>
              <div class="sample-outbound-panel-subtitle">右下角快速完成托盘出库与去向选择。</div>
            </div>
            <label class="sample-outbound-field">
              <span>托盘编号</span>
              <input
                class="sample-outbound-input"
                data-testid="samples-process-outbound-input"
                type="text"
                placeholder="扫码后自动填入托盘编号"
                :value="samplesProcess.outboundTrayCode"
                :disabled="!samplesProcess.storeLocked"
                @input="samplesProcess.setOutboundTrayCode($event.target.value)"
              />
            </label>
            <div class="sample-outbound-card-grid">
              <button
                v-for="card in samplesProcess.outboundCards"
                :key="card.key"
                type="button"
                class="sample-outbound-card"
                :class="[
                  `is-${card.variant || 'default'}`,
                  {
                    'is-selected': card.key === samplesProcess.selectedOutboundKey,
                    'is-highlighted': card.highlighted,
                  },
                ]"
                :data-testid="`samples-process-outbound-card-${card.key}`"
                :disabled="!samplesProcess.storeLocked || !card.available"
                @click="samplesProcess.selectOutboundDestination(card.key)"
              >
                <div class="sample-outbound-card-title">{{ card.label }}</div>
                <div class="sample-outbound-card-meta">{{ card.testType || "中转缓冲" }}</div>
                <div class="sample-outbound-card-task">{{ card.taskCode || "-" }}</div>
                <div class="sample-outbound-card-schedule">{{ card.scheduleText || "-" }}</div>
              </button>
            </div>
            <div class="sample-outbound-actions">
              <button
                class="action-btn secondary"
                type="button"
                data-testid="samples-process-outbound-submit"
                :disabled="!samplesProcess.canSubmitOutbound"
                @click="samplesProcess.submitOutbound"
              >
                出库
              </button>
            </div>
          </section>
        </div>
        <div class="form-alert" :class="{ 'is-hidden': !samplesProcess.warning }">{{ samplesProcess.warning }}</div>
      </div>
      <div v-if="!hideFlow" class="sample-flow-card">
        <div class="sample-flow-title">统一样品流程图</div>
        <div class="sample-flow-status">{{ samplesProcess.currentFlowStatus }}</div>
        <ol class="sample-flow-unified">
          <li
            v-for="(step, index) in samplesProcess.flowSteps"
            :key="step.key"
            :data-flow-step="index"
            :data-testid="`sample-flow-step-${step.key}`"
            :class="{ current: step.active, reached: step.reached }"
          >
            {{ step.label }}
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<script setup>
defineProps({
  samplesProcess: {
    type: Object,
    required: true,
  },
  showOutbound: {
    type: Boolean,
    default: false,
  },
  hideFlow: {
    type: Boolean,
    default: false,
  },
  compactOutbound: {
    type: Boolean,
    default: false,
  },
});
</script>
