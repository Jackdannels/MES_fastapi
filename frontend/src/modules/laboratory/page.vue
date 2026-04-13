<template>
  <div class="laboratory-page">
    <Teleport v-if="canTeleportScheduleAction" to=".header-actions">
      <button
        v-if="runningExperiment.active"
        class="action-btn secondary laboratory-header-action-button laboratory-header-action-button--overview"
        data-testid="laboratory-open-overview"
        type="button"
        @click="showRunningModal"
      >
        总览
      </button>
      <button
        class="action-btn secondary laboratory-header-action-button laboratory-header-action-button--schedule"
        data-testid="laboratory-open-schedule"
        type="button"
        :disabled="runningInteractionLocked"
        @click="openScheduleBoard"
      >
        查看排程
      </button>
    </Teleport>

    <section class="grid laboratory-summary-grid stagger">
      <div class="card">
        <div class="muted">今日实验排程数量</div>
        <div class="kpi">{{ summary.todayPendingCount }}</div>
      </div>
      <div class="card">
        <div class="muted">今日未做实验数量</div>
        <div class="kpi">{{ summary.todayUndoneCount }}</div>
      </div>
    </section>

    <section class="card section laboratory-control-card">
      <div class="laboratory-control-header">
        <div>
          <h3>盐雾试验室操作台</h3>
          <p class="muted">当前实验室固定为盐雾试验室，任务与实验准备流程按现有项目数据口径展示。</p>
        </div>
        <span class="pill">当前实验室任务</span>
      </div>

      <div class="laboratory-actions-grid">
        <article class="laboratory-action-item laboratory-action-item--tasks">
          <div class="laboratory-action-copy">
            <span class="muted">清单</span>
            <h4>查看当前实验室任务</h4>
          </div>
          <button class="action-btn secondary laboratory-action-button" data-testid="laboratory-view-tasks" type="button" @click="openTaskList">
            查看任务
          </button>
        </article>

        <article class="laboratory-action-item laboratory-action-item--compare" :class="{ 'is-locked': !actionState.canCompare }">
          <div class="laboratory-action-copy">
            <span class="muted">步骤 1</span>
            <h4>任务比对</h4>
          </div>
          <button
            class="action-btn laboratory-action-button"
            data-testid="laboratory-compare"
            type="button"
            :disabled="runningInteractionLocked || !actionState.canCompare"
            @click="openCompare"
          >
            比对任务
          </button>
        </article>

        <article class="laboratory-action-item laboratory-action-item--install" :class="{ 'is-locked': !actionState.canInstallSample }">
          <div class="laboratory-action-copy">
            <span class="muted">步骤 2</span>
            <h4>样品安装</h4>
          </div>
          <button
            class="action-btn laboratory-action-button"
            data-testid="laboratory-install"
            type="button"
            :disabled="runningInteractionLocked || !actionState.canInstallSample"
            @click="openInstall"
          >
            安装样品
          </button>
        </article>

        <article class="laboratory-action-item laboratory-action-item--ready" :class="{ 'is-locked': !actionState.canMarkReady }">
          <div class="laboratory-action-copy">
            <span class="muted">步骤 3</span>
            <h4>确认准备就绪</h4>
          </div>
          <button
            class="action-btn laboratory-action-button"
            data-testid="laboratory-ready"
            type="button"
            :disabled="runningInteractionLocked || !actionState.canMarkReady"
            @click="openReady"
          >
            确认准备就绪
          </button>
        </article>
      </div>

      <div class="laboratory-recent-tasks">
        <div class="laboratory-recent-tasks__header">
          <h4>最近安排任务</h4>
          <span class="muted">默认按最近安排任务执行，也可在查看任务中切换当前任务。</span>
        </div>
        <div class="laboratory-recent-tasks__list">
          <article
            v-for="row in recentTasks"
            :key="`recent-${row.id}`"
            class="laboratory-recent-task"
            :class="{ 'is-current': currentTask && currentTask.taskCode === row.taskCode }"
          >
            <div class="laboratory-recent-task__head">
              <strong class="laboratory-recent-task__code">{{ row.taskCode }}</strong>
              <span v-if="currentTask && currentTask.taskCode === row.taskCode" class="pill">当前任务</span>
            </div>
            <div class="laboratory-recent-task__experiment muted">{{ row.experimentName }}</div>
            <div class="laboratory-recent-task__time">{{ row.dateTimeRange }}</div>
          </article>
        </div>
      </div>

      <div class="laboratory-progress-panel">
        <h4>流程状态</h4>
        <div class="laboratory-flow-grid">
          <section class="laboratory-flow-card" data-testid="laboratory-task-flow">
            <div class="laboratory-flow-card__head">
              <div>
                <div class="laboratory-flow-card__title">任务流程图</div>
                <div class="muted">
                  {{ currentTask ? `${currentTask.taskCode} / ${currentTask.experimentName}` : "当前盐雾试验室暂无排程" }}
                </div>
              </div>
            </div>
            <div class="laboratory-flow-status" data-testid="laboratory-task-flow-status">{{ currentTaskFlow.currentStatus }}</div>
            <ol class="laboratory-flow-steps">
              <li
                v-for="step in currentTaskFlow.steps"
                :key="`task-flow-${step.key}`"
                :class="{ 'is-active': step.active, 'is-reached': step.reached }"
              >
                {{ step.label }}
              </li>
            </ol>
            <div class="muted laboratory-flow-note">{{ progressMessage }}</div>
          </section>

          <section class="laboratory-flow-card" data-testid="laboratory-tray-flow">
            <div class="laboratory-flow-card__head laboratory-flow-card__head--stacked">
              <div>
                <div class="laboratory-flow-card__title">托盘流程图</div>
                <div class="muted">
                  {{ currentTask ? `${currentTask.taskCode} / ${currentTask.experimentName}` : "当前无可切换托盘" }}
                </div>
              </div>
              <div class="laboratory-tray-tabs">
                <button
                  v-for="tray in currentExperimentTrayRows"
                  :key="`tray-tab-${tray.trayCode}`"
                  class="laboratory-tray-tab"
                  :class="{ 'is-active': selectedTrayRow && selectedTrayRow.trayCode === tray.trayCode }"
                  :data-testid="`laboratory-tray-tab-${tray.trayCode}`"
                  type="button"
                  @click="setSelectedTrayCode(tray.trayCode)"
                >
                  {{ tray.trayCode }}
                </button>
              </div>
            </div>
            <div class="laboratory-flow-status" data-testid="laboratory-tray-flow-status">{{ selectedTrayFlow.currentStatus }}</div>
            <ol class="laboratory-flow-steps laboratory-flow-steps--tray">
              <li
                v-for="step in selectedTrayFlow.steps"
                :key="`tray-flow-${step.key}`"
                :class="{ 'is-active': step.active, 'is-reached': step.reached }"
              >
                {{ step.label }}
              </li>
            </ol>
          </section>
        </div>
      </div>
    </section>

    <AppModal :open="scheduleModalOpen" data-testid="laboratory-schedule-modal" title="实验排程清单" @close="closeScheduleBoard">
      <div class="laboratory-modal-body">
        <table class="table laboratory-schedule-card">
          <thead>
            <tr>
              <th>任务编号</th>
              <th>实验</th>
              <th>执行人员</th>
              <th>计划时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in scheduleRows" :key="row.id">
              <td>{{ row.taskCode }}</td>
              <td>{{ row.experimentName }}</td>
              <td>{{ row.owner }}</td>
              <td>{{ row.timeRange }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppModal>

    <AppModal
      :open="taskListModalOpen"
      class="laboratory-task-list-modal"
      data-testid="laboratory-task-list-modal"
      title="当前实验室任务清单"
      @close="closeTaskList"
    >
      <div class="laboratory-modal-body">
        <table class="table laboratory-task-list-card">
          <thead>
            <tr>
              <th>任务编号</th>
              <th>实验</th>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>样品数量</th>
              <th>托盘</th>
              <th>当前任务</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in scheduleRows"
              :key="`${row.id}-task`"
              class="laboratory-task-list-row"
              :class="{
                'is-current': currentTask && currentTask.taskCode === row.taskCode,
                'is-pending': pendingTaskCode === row.taskCode && (!currentTask || currentTask.taskCode !== row.taskCode),
              }"
              :data-testid="`laboratory-task-row-${row.taskCode}`"
            >
              <td>{{ row.taskCode }}</td>
              <td>{{ row.experimentName }}</td>
              <td>{{ row.startDateTimeLabel }}</td>
              <td>{{ row.endDateTimeLabel }}</td>
              <td>{{ row.sampleCount }}</td>
              <td>
                <div class="laboratory-task-tray-list">
                  <div v-for="tray in row.trayRows" :key="`${row.id}-${tray.trayCode}`" class="laboratory-task-tray-row">
                    <span class="laboratory-tray-chip">{{ tray.trayCode }}</span>
                  </div>
                </div>
              </td>
              <td>
                <button
                  class="action-btn secondary"
                  :data-testid="`laboratory-select-task-${row.taskCode}`"
                  type="button"
                  :disabled="runningInteractionLocked"
                  @click="setPendingTaskCode(row.taskCode)"
                >
                  {{ pendingTaskCode === row.taskCode ? "已选中" : "选择任务" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <button
          class="action-btn"
          data-testid="laboratory-confirm-current-task"
          type="button"
          :disabled="runningInteractionLocked"
          @click="confirmCurrentTask"
        >
          确认当前任务
        </button>
      </template>
    </AppModal>

    <AppModal :open="compareModalOpen" data-testid="laboratory-compare-modal" title="任务比对" @close="closeCompare">
      <div class="laboratory-modal-body">
        <div class="laboratory-compare-head">
          <h4>即将进行实验任务的详细清单</h4>
          <span class="pill">盐雾试验室</span>
        </div>
        <div class="laboratory-checklist-card">
          <div v-for="item in checklist" :key="item.label" class="laboratory-checklist-item">
            <strong>{{ item.label }}</strong>
            <span>{{ item.value }}</span>
          </div>
        </div>
        <div class="laboratory-compare-scan">
          <label class="form-field">
            <span>扫码托盘</span>
            <input v-model="compareScanCode" data-testid="laboratory-compare-scan-input" type="text" placeholder="请扫描或输入托盘编号" />
          </label>
          <button class="action-btn" data-testid="laboratory-compare-scan-submit" type="button" @click="submitCompareScan">扫码确认</button>
        </div>
        <div
          v-if="compareFeedback"
          class="laboratory-compare-feedback"
          :class="compareFeedback.tone === 'success' ? 'is-success' : 'is-error'"
          :data-tone="compareFeedback.tone"
          data-testid="laboratory-compare-feedback"
        >
          <strong>{{ compareFeedback.message }}</strong>
          <div>{{ compareFeedback.guidance }}</div>
        </div>
      </div>
      <template #footer>
        <button class="action-btn" :disabled="!canCompleteCompare" data-testid="laboratory-compare-complete" type="button" @click="confirmCompare">比对完成</button>
      </template>
    </AppModal>

    <AppModal :open="installModalOpen" data-testid="laboratory-install-modal" title="样品安装" @close="closeInstall">
      <div class="laboratory-modal-body laboratory-prompt-card">
        <p>请安装样品，并确认盐雾试验室当前任务已准备完成。</p>
      </div>
      <template #footer>
        <button class="action-btn secondary" data-testid="laboratory-install-cancel" type="button" @click="closeInstall">取消</button>
        <button class="action-btn" data-testid="laboratory-install-confirm" type="button" @click="confirmInstall">安装完成</button>
      </template>
    </AppModal>

    <AppModal :open="readyModalOpen" data-testid="laboratory-ready-modal" title="确认实验准备就绪" @close="closeReady">
      <div class="laboratory-modal-body laboratory-prompt-card">
        <p>确定当前盐雾试验室任务已完成实验准备，并将状态更新为实验准备就绪。</p>
      </div>
      <template #footer>
        <button class="action-btn secondary" data-testid="laboratory-ready-cancel" type="button" @click="closeReady">取消</button>
        <button class="action-btn" data-testid="laboratory-ready-confirm" type="button" @click="confirmReady">确认准备就绪</button>
      </template>
    </AppModal>

    <AppModal :open="confirmedModalOpen" data-testid="laboratory-confirmed-modal" title="实验准备就绪确认完成" @close="closeConfirmed">
      <div class="laboratory-modal-body laboratory-prompt-card">
        <p>当前任务已确认实验准备就绪。</p>
      </div>
      <template #footer>
        <button class="action-btn" type="button" @click="closeConfirmed">关闭</button>
      </template>
    </AppModal>

    <Teleport v-if="runningExperiment.active && runningModalVisible" to="body">
      <div class="laboratory-running-overlay" data-testid="laboratory-running-overlay">
        <div class="laboratory-running-overlay__backdrop" data-testid="laboratory-running-backdrop" @click="hideRunningModal"></div>
        <div class="laboratory-running-overlay__content laboratory-running-modal" data-testid="laboratory-running-modal">
          <div class="laboratory-running-modal__head">
            <div>
              <div class="muted">当前进行实验</div>
              <h4>{{ runningExperiment.taskCode }} / {{ runningExperiment.experimentName }}</h4>
            </div>
            <span class="pill">实验进行中</span>
          </div>
          <div class="laboratory-running-countdown" data-testid="laboratory-running-countdown">{{ runningExperiment.countdownLabel }}</div>
          <div class="laboratory-running-times muted">
            <span>开始：{{ runningExperiment.startDateTimeLabel }}</span>
            <span>预计完成：{{ runningExperiment.endDateTimeLabel }}</span>
          </div>
          <div class="laboratory-running-grid">
            <div>
              <strong>运行托盘</strong>
              <div class="laboratory-running-tags">
                <span v-for="trayCode in runningExperiment.trayCodes" :key="`running-tray-${trayCode}`" class="laboratory-tray-chip">{{ trayCode }}</span>
              </div>
            </div>
            <div>
              <strong>对应样品</strong>
              <div class="laboratory-running-tags">
                <span v-for="sampleCode in runningExperiment.sampleCodes" :key="`running-sample-${sampleCode}`" class="laboratory-tray-chip">{{ sampleCode }}</span>
              </div>
            </div>
          </div>
          <div class="laboratory-running-modal__hint muted">
            <span>点击空白处可临时隐藏弹窗，10 秒无操作后会自动恢复。</span>
            <span v-if="runningExperiment.remainingSeconds <= 0">实验已超时，请在确认现场状态后完成实验。</span>
          </div>
          <div v-if="completePromptVisible" class="laboratory-running-complete-prompt" data-testid="laboratory-complete-prompt">
            <p><strong>任务编号</strong> {{ runningExperiment.taskCode }}</p>
            <p><strong>实验名称</strong> {{ runningExperiment.experimentName }}</p>
            <p><strong>托盘</strong> {{ runningExperiment.trayCodes.join("、") || "-" }}</p>
            <p><strong>样品</strong> {{ runningExperiment.sampleCodes.join("、") || "-" }}</p>
            <p>确认后将把当前盐雾实验更新为实验已完成。</p>
            <div class="laboratory-running-complete-prompt__actions">
              <button class="action-btn secondary" type="button" @click="closeCompleteConfirm">取消</button>
              <button class="action-btn" data-testid="laboratory-complete-experiment-confirm" type="button" @click="confirmCompleteExperiment">确认实验完成</button>
            </div>
          </div>
          <div class="laboratory-running-actions">
            <button v-if="!completePromptVisible" class="action-btn" data-testid="laboratory-complete-experiment" type="button" @click="openCompleteConfirm">实验完成</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { Teleport } from "vue";

import AppModal from "@/components/shared/AppModal.vue";
import { useLaboratoryPage } from "./useLaboratoryPage";

const {
  actionState,
  canTeleportScheduleAction,
  canCompleteCompare,
  checklist,
  closeCompleteConfirm,
  compareFeedback,
  compareScanCode,
  closeCompare,
  closeConfirmed,
  closeInstall,
  closeReady,
  closeScheduleBoard,
  closeTaskList,
  compareModalOpen,
  completePromptVisible,
  confirmCurrentTask,
  confirmCompare,
  confirmCompleteExperiment,
  confirmInstall,
  confirmReady,
  confirmedModalOpen,
  currentExperimentTrayRows,
  currentTask,
  currentTaskFlow,
  hideRunningModal,
  installModalOpen,
  openCompleteConfirm,
  openCompare,
  openInstall,
  openReady,
  openScheduleBoard,
  openTaskList,
  pendingTaskCode,
  progressMessage,
  readyModalOpen,
  recentTasks,
  runningExperiment,
  runningInteractionLocked,
  runningModalVisible,
  scheduleModalOpen,
  scheduleRows,
  selectedTrayFlow,
  selectedTrayRow,
  setPendingTaskCode,
  setSelectedTrayCode,
  showRunningModal,
  summary,
  submitCompareScan,
  taskListModalOpen,
  verifiedTrayCodes,
} = useLaboratoryPage();
</script>
