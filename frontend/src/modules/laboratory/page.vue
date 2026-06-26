<template>
  <div class="laboratory-page">
    <Teleport v-if="canTeleportScheduleAction" to=".header-actions-before-logout">
      <button
        class="action-btn secondary laboratory-header-action-button laboratory-header-action-button--overview"
        data-testid="laboratory-show-running-modal"
        type="button"
        :disabled="!runningExperiment.active"
        @click="showRunningModal"
      >
        显示弹窗
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
          <h3>{{ labName }}操作台</h3>
          <p class="muted">当前实验室为{{ labName }}，任务与实验准备流程按现有项目数据口径展示。</p>
        </div>
        <button
          class="laboratory-reset-button"
          data-testid="laboratory-reset-task"
          type="button"
          :disabled="!canResetCurrentTask"
          @click="openResetConfirm"
        >
          重置实验室任务
        </button>
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

        <article class="laboratory-action-item laboratory-action-item--install" :class="{ 'is-locked': !canRequestFixtureInstall }">
          <div class="laboratory-action-copy">
            <span class="muted">步骤 2</span>
            <h4>样品安装</h4>
          </div>
          <button
            class="action-btn laboratory-action-button"
            data-testid="laboratory-install"
            type="button"
            :disabled="runningInteractionLocked || !canRequestFixtureInstall"
            @click="openInstall"
          >
            {{ installActionLabel }}
          </button>
        </article>

        <article class="laboratory-action-item laboratory-action-item--ready" :class="{ 'is-locked': !canRequestReady }">
          <div class="laboratory-action-copy">
            <span class="muted">步骤 3</span>
            <h4>确认准备就绪</h4>
          </div>
          <button
            class="action-btn laboratory-action-button"
            data-testid="laboratory-ready"
            type="button"
            :disabled="runningInteractionLocked || !canRequestReady"
            @click="openReady"
          >
            {{ readyActionLabel }}
          </button>
        </article>
      </div>

      <div v-if="laboratoryMqError" class="laboratory-empty-hint" data-testid="laboratory-mq-error">
        {{ laboratoryMqError.title }}：{{ laboratoryMqError.detail }}
      </div>

      <div v-if="laboratoryTaskNotice" class="laboratory-empty-hint" data-testid="laboratory-task-empty-hint">
        {{ laboratoryTaskNotice }}
      </div>

      <div class="laboratory-recent-tasks">
        <div class="laboratory-recent-tasks__header">
          <h4>最近安排任务</h4>
          <span class="muted">默认按最近安排任务执行，也可在查看任务中切换当前任务。</span>
        </div>
        <div class="laboratory-recent-tasks__list">
          <div v-if="!recentTasks.length" class="laboratory-recent-task laboratory-recent-task--empty">
            当前{{ labName }}暂无任务
          </div>
          <article
            v-for="row in recentTasks"
            :key="`recent-${row.id}`"
            class="laboratory-recent-task"
            :class="{ 'is-current': currentTask && currentTask.id === row.id }"
          >
            <div class="laboratory-recent-task__head">
              <strong class="laboratory-recent-task__code">{{ row.taskCode }}</strong>
              <span v-if="currentTask && currentTask.id === row.id" class="pill">当前任务</span>
            </div>
            <div class="laboratory-recent-task__experiment muted">{{ row.experimentName }}</div>
            <div v-if="row.axisCodes?.length" class="laboratory-recent-task__axes" data-testid="laboratory-recent-task-axes">
              轴向：{{ row.axisCodes.join("、") }}
            </div>
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
                  {{ currentTask ? `${currentTask.taskCode} / ${currentTask.experimentName}` : `当前${labName}暂无排程` }}
                </div>
              </div>
            </div>
            <ol class="laboratory-flow-steps">
              <li
                v-for="step in currentTaskFlow.steps"
                :key="`task-flow-${step.key}`"
                :class="{ 'is-active': step.active, 'is-reached': step.reached }"
              >
                {{ step.label }}
              </li>
            </ol>
            <div class="laboratory-flow-status" data-testid="laboratory-task-flow-status">{{ currentTaskFlow.currentStatus }}</div>
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
            <ol class="laboratory-flow-steps laboratory-flow-steps--tray" data-testid="laboratory-tray-flow-list">
              <li
                v-for="step in selectedTrayFlow.steps"
                :key="`tray-flow-${step.key}`"
                :data-testid="`laboratory-tray-flow-step-${step.key}`"
                :class="{ 'is-active': step.active, 'is-reached': step.reached }"
              >
                <span class="laboratory-flow-label">{{ step.label }}</span>
                <span class="laboratory-flow-time" :title="formatFlowTime(step.time)">{{ formatFlowTime(step.time) }}</span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </section>

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
          <tbody v-if="scheduleRows.length">
            <tr
              v-for="row in scheduleRows"
              :key="`${row.id}-task`"
              class="laboratory-task-list-row"
              :class="{
                'is-current': currentTask && currentTask.id === row.id,
                'is-pending': pendingTaskCode === row.id && (!currentTask || currentTask.id !== row.id),
              }"
              :data-testid="`laboratory-task-row-${row.taskCode}`"
            >
              <td>{{ row.taskCode }}</td>
              <td>{{ row.experimentName }}</td>
              <td>{{ row.startDateTimeLabel }}</td>
              <td>{{ row.endDateTimeLabel }}</td>
              <td>{{ row.sampleCount }}</td>
              <td>
                <div class="laboratory-task-tray-list laboratory-task-tray-list--grid">
                  <div v-for="tray in previewItems(row.trayRows, TASK_TRAY_PREVIEW_LIMIT)" :key="`${row.id}-${tray.trayCode}`" class="laboratory-task-tray-row">
                    <span class="laboratory-tray-chip">{{ tray.trayCode }}</span>
                  </div>
                  <span v-if="overflowCount(row.trayRows, TASK_TRAY_PREVIEW_LIMIT) > 0" class="laboratory-more-count">
                    +{{ overflowCount(row.trayRows, TASK_TRAY_PREVIEW_LIMIT) }}
                  </span>
                  <button
                    v-if="overflowCount(row.trayRows, TASK_TRAY_PREVIEW_LIMIT) > 0"
                    class="laboratory-inline-link"
                    :data-testid="`laboratory-task-row-show-all-${row.taskCode}`"
                    type="button"
                    @click="openTaskRowFullContent(row)"
                  >
                    查看全部
                  </button>
                </div>
              </td>
              <td>
                <button
                  class="action-btn secondary"
                  :data-testid="`laboratory-select-task-${row.taskCode}`"
                  type="button"
                  :disabled="!canSelectTaskKey(row.id)"
                  @click="setPendingTaskCode(row.id)"
                >
                  {{ pendingTaskCode === row.id ? "已选中" : "选择任务" }}
                </button>
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td colspan="7" class="laboratory-empty-table-cell">当前实验室暂无任务</td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <button
          class="action-btn"
          data-testid="laboratory-confirm-current-task"
          type="button"
          :disabled="runningInteractionLocked || !pendingTaskCode"
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
          <span class="pill">{{ labName }}</span>
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
            <input
              ref="compareScanInputRef"
              v-model="compareScanCode"
              data-testid="laboratory-compare-scan-input"
              type="text"
              placeholder="请扫描或输入托盘编号"
              @keyup.enter="submitCompareScan"
            />
          </label>
          <button class="action-btn" data-testid="laboratory-compare-scan-submit" type="button" @click="submitCompareScan">扫码确认</button>
        </div>
        <AppFeedback
          v-if="compareFeedback"
          :message="compareFeedback.message"
          :tone="compareFeedback.tone === 'success' ? 'success' : 'error'"
          :data-tone="compareFeedback.tone"
          data-testid="laboratory-compare-feedback"
          @close="compareFeedback = null"
        >
          <strong>{{ compareFeedback.message }}</strong>
          <div>{{ compareFeedback.guidance }}</div>
        </AppFeedback>
      </div>
      <template #footer>
        <button class="action-btn" :disabled="!canCompleteCompare" data-testid="laboratory-compare-complete" type="button" @click="confirmCompare">比对完成</button>
      </template>
    </AppModal>

    <AppModal :open="installModalOpen" data-testid="laboratory-install-modal" title="样品安装" @close="closeInstall">
      <div class="laboratory-modal-body laboratory-prompt-card">
        <p>{{ installActionLabel === "重新下发安装" ? "将重新向上位机下发夹具安装命令，请确认上位机已连接并订阅当前试验间。" : `请安装样品，并确认${labName}当前任务已准备完成。` }}</p>
      </div>
      <template #footer>
        <button class="action-btn secondary" data-testid="laboratory-install-cancel" type="button" @click="closeInstall">取消</button>
        <button class="action-btn" data-testid="laboratory-install-confirm" type="button" @click="confirmInstall">安装完成</button>
      </template>
    </AppModal>

    <AppModal
      :open="fullContentModalOpen"
      class="laboratory-full-content-modal"
      data-testid="laboratory-full-content-modal"
      title="全部托盘与样品"
      @close="closeFullContentModal"
    >
      <div class="laboratory-modal-body">
        <div class="laboratory-full-content-summary">
          <span>任务编号：{{ fullContentDetail?.taskCode || "-" }}</span>
          <span>实验：{{ fullContentDetail?.experimentName || "-" }}</span>
          <span>托盘：{{ fullContentDetail?.trayRows?.length || 0 }}</span>
          <span>样品：{{ fullContentDetail?.sampleCodes?.length || 0 }}</span>
        </div>
        <div class="laboratory-full-tray-list">
          <article
            v-for="tray in fullContentDetail?.trayRows || []"
            :key="`full-${tray.trayCode}`"
            class="laboratory-full-tray-row"
            :data-testid="`laboratory-full-tray-row-${tray.trayCode}`"
          >
            <div>
              <strong>{{ tray.trayCode }}</strong>
              <span>{{ tray.trayStatus || tray.displayStatus || "-" }}</span>
            </div>
            <div class="laboratory-full-sample-list">
              <span v-for="sampleCode in tray.sampleCodes || []" :key="`${tray.trayCode}-${sampleCode}`">{{ sampleCode }}</span>
              <span v-if="!(tray.sampleCodes || []).length" class="muted">暂无样品编号</span>
            </div>
          </article>
        </div>
      </div>
    </AppModal>

    <AppModal :open="fixtureConfirmModalOpen" data-testid="laboratory-fixture-confirm-modal" title="夹具安装确认中" @close="() => {}">
      <div class="laboratory-modal-body laboratory-prompt-card laboratory-fixture-status-card">
        <div class="laboratory-fixture-status-card__head">
          <span class="laboratory-fixture-status-card__eyebrow">{{ fixtureConfirmCopy.eyebrow }}</span>
          <strong>{{ currentTask?.taskCode || "-" }}</strong>
          <span>{{ labName }}</span>
        </div>
        <div class="laboratory-fixture-countdown" aria-live="polite">
          <strong data-testid="laboratory-fixture-confirm-countdown">{{ fixtureConfirmCountdown }}</strong>
          <span>秒</span>
        </div>
        <p>{{ fixtureConfirmCopy.body }}</p>
      </div>
    </AppModal>

    <AppModal :open="fixtureConfirmSuccessModalOpen" data-testid="laboratory-fixture-success-modal" title="夹具安装完成" @close="() => {}">
      <div class="laboratory-modal-body laboratory-prompt-card laboratory-fixture-success-card">
        <div class="laboratory-fixture-success-card__mark">OK</div>
        <strong>{{ fixtureConfirmCopy.successTitle }}</strong>
        <p>{{ fixtureConfirmCopy.successBody }}</p>
      </div>
    </AppModal>

    <AppModal :open="readyModalOpen" data-testid="laboratory-ready-modal" title="确认实验准备就绪" @close="closeReady">
      <div class="laboratory-modal-body laboratory-prompt-card">
        <p>确定当前{{ labName }}任务已完成实验准备，并将状态更新为实验准备就绪。</p>
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

    <AppModal :open="resetConfirmModalOpen" data-testid="laboratory-reset-confirm-modal" title="确认撤回任务" @close="closeResetConfirm">
      <div class="laboratory-modal-body laboratory-prompt-card">
        <p>是否撤回当前任务下当前实验对应托盘？撤回后将恢复到上一个有效出库发起点。</p>
      </div>
      <template #footer>
        <button class="action-btn secondary" data-testid="laboratory-reset-cancel" type="button" @click="closeResetConfirm">取消</button>
        <button class="action-btn" data-testid="laboratory-reset-confirm" type="button" @click="confirmResetPrompt">确认撤回</button>
      </template>
    </AppModal>

    <AppModal :open="resetDangerModalOpen" data-testid="laboratory-reset-danger-modal" title="危险操作确认" @close="closeResetDanger">
      <div class="laboratory-modal-body">
        <div class="laboratory-danger-panel">
          <strong>危险操作确认</strong>
          <p>撤回后仅影响当前实验对应托盘，并会恢复到到货、已到达暂存间或上一实验已完成状态。</p>
        </div>
      </div>
      <template #footer>
        <button class="action-btn secondary" data-testid="laboratory-reset-danger-cancel" type="button" @click="closeResetDanger">取消</button>
        <button class="action-btn danger" data-testid="laboratory-reset-danger-confirm" type="button" @click="confirmResetTask">确认撤回</button>
      </template>
    </AppModal>

    <Teleport v-if="runningModalExperiment.active && runningModalVisible" to="body">
      <div class="laboratory-running-overlay" data-testid="laboratory-running-overlay">
        <div class="laboratory-running-overlay__backdrop" data-testid="laboratory-running-backdrop" @click="hideRunningModal"></div>
        <div class="laboratory-running-overlay__content laboratory-running-modal" data-testid="laboratory-running-modal">
          <div class="laboratory-running-modal__head">
            <div>
              <div class="muted">{{ runningModalExperiment.completed ? "实验完成" : "当前进行实验" }}</div>
              <h4>{{ runningModalExperiment.taskCode }} / {{ runningModalExperiment.experimentName }}</h4>
            </div>
            <span class="pill">{{ runningModalExperiment.completed ? "实验已完成" : "实验进行中" }}</span>
          </div>
          <div class="laboratory-running-countdown" data-testid="laboratory-running-countdown">{{ runningModalExperiment.countdownLabel }}</div>
          <div v-if="runningModalExperiment.axisStatusLabel" class="laboratory-running-axis-status" data-testid="laboratory-running-axis-status">
            <strong>{{ runningModalExperiment.axisStatusLabel }}</strong>
            <span>{{ runningModalExperiment.axisCompletedLabel }}</span>
            <span>{{ runningModalExperiment.axisUnfinishedLabel }}</span>
          </div>
          <div class="laboratory-running-times muted">
            <span>开始：{{ runningModalExperiment.startDateTimeLabel }}</span>
            <span>{{ runningModalExperiment.completed ? "完成" : "预计完成" }}：{{ runningModalExperiment.endDateTimeLabel }}</span>
          </div>
          <div class="laboratory-running-grid">
            <div>
              <strong>运行托盘</strong>
              <div class="laboratory-running-tags">
                <span
                  v-for="trayCode in previewItems(runningModalExperiment.trayCodes, RUNNING_TRAY_PREVIEW_LIMIT)"
                  :key="`running-tray-${trayCode}`"
                  class="laboratory-tray-chip"
                  :data-testid="`laboratory-running-tray-chip-${trayCode}`"
                >
                  {{ trayCode }}
                </span>
                <span v-if="overflowCount(runningModalExperiment.trayCodes, RUNNING_TRAY_PREVIEW_LIMIT) > 0" class="laboratory-more-count">
                  +{{ overflowCount(runningModalExperiment.trayCodes, RUNNING_TRAY_PREVIEW_LIMIT) }}
                </span>
              </div>
            </div>
            <div>
              <strong>对应样品</strong>
              <div class="laboratory-running-tags">
                <span
                  v-for="sampleCode in previewItems(runningModalExperiment.sampleCodes, RUNNING_SAMPLE_PREVIEW_LIMIT)"
                  :key="`running-sample-${sampleCode}`"
                  class="laboratory-tray-chip"
                  :data-testid="`laboratory-running-sample-chip-${sampleCode}`"
                >
                  {{ sampleCode }}
                </span>
                <span v-if="overflowCount(runningModalExperiment.sampleCodes, RUNNING_SAMPLE_PREVIEW_LIMIT) > 0" class="laboratory-more-count">
                  +{{ overflowCount(runningModalExperiment.sampleCodes, RUNNING_SAMPLE_PREVIEW_LIMIT) }}
                </span>
              </div>
            </div>
          </div>
          <button
            v-if="runningModalExperiment.trayCodes.length > RUNNING_TRAY_PREVIEW_LIMIT || runningModalExperiment.sampleCodes.length > RUNNING_SAMPLE_PREVIEW_LIMIT"
            class="laboratory-inline-link laboratory-running-show-all"
            data-testid="laboratory-running-show-all"
            type="button"
            @click="openRunningFullContent"
          >
            查看全部
          </button>
          <div class="laboratory-running-modal__hint muted">
            <span>{{ runningModalExperiment.completed ? "实验状态已自动更新为实验已完成。" : "点击空白处可临时隐藏弹窗，10 秒无操作后会自动恢复。" }}</span>
            <span v-if="!runningModalExperiment.completed && runningModalExperiment.remainingSeconds <= 0">实验已超时，请在确认现场状态后完成实验。</span>
          </div>
          <div v-if="completePromptVisible && !runningModalExperiment.completed" class="laboratory-running-complete-prompt" data-testid="laboratory-complete-prompt">
            <p><strong>任务编号</strong> {{ runningModalExperiment.taskCode }}</p>
            <p><strong>实验名称</strong> {{ runningModalExperiment.experimentName }}</p>
            <p><strong>托盘</strong> {{ runningModalExperiment.trayCodes.length }} 个</p>
            <p><strong>样品</strong> {{ runningModalExperiment.sampleCodes.length }} 个</p>
            <button class="laboratory-inline-link" type="button" @click="openRunningFullContent">查看全部</button>
            <p>
              {{
                currentAxisCompletion.enabled
                  ? `确认后将把当前轴向 ${currentAxisCompletion.axisCode} 更新为已完成。`
                  : `确认后将把当前${runningModalExperiment.experimentName || labName}更新为实验已完成。`
              }}
            </p>
            <div class="laboratory-running-complete-prompt__actions">
              <button class="action-btn secondary" type="button" @click="closeCompleteConfirm">取消</button>
              <button class="action-btn" data-testid="laboratory-complete-experiment-confirm" type="button" @click="confirmCompleteExperiment">
                {{ currentAxisCompletion.enabled ? "确认当前轴完成" : "确认实验完成" }}
              </button>
            </div>
          </div>
          <div class="laboratory-running-actions">
            <button v-if="!completePromptVisible && !runningModalExperiment.completed" class="action-btn" data-testid="laboratory-complete-experiment" type="button" @click="openCompleteConfirm">
              {{ currentAxisCompletion.enabled ? "当前轴完成" : "实验完成" }}
            </button>
            <button
              v-if="!completePromptVisible && !runningModalExperiment.completed && runningModalExperiment.axisContinuation?.nextAxisCode"
              class="action-btn success"
              data-testid="laboratory-complete-axis-continue"
              type="button"
              :disabled="!runningModalExperiment.axisContinuation?.canContinue"
              @click="confirmCompleteAxisAndContinue"
            >
              当前轴向完成，继续进行下一实验 {{ runningModalExperiment.axisContinuation.nextAxisCode }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
defineOptions({
  name: "LaboratoryPage",
});

import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppModal from "@/components/shared/AppModal.vue";
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useLaboratoryPage } from "./useLaboratoryPage";

const TASK_TRAY_PREVIEW_LIMIT = 3;
const RUNNING_TRAY_PREVIEW_LIMIT = 3;
const RUNNING_SAMPLE_PREVIEW_LIMIT = 5;
const route = useRoute();
const selectedLabName = computed(() => {
  const rawLabName = route.query?.lab;
  return Array.isArray(rawLabName) ? rawLabName[0] || "" : rawLabName || "";
});

const {
  actionState,
  canRequestFixtureInstall,
  canRequestReady,
  canTeleportScheduleAction,
  canCompleteCompare,
  canResetCurrentTask,
  canSelectTaskKey,
  checklist,
  closeCompleteConfirm,
  compareFeedback,
  compareScanInputRef,
  compareScanCode,
  closeCompare,
  closeConfirmed,
  closeInstall,
  closeReady,
  closeResetConfirm,
  closeResetDanger,
  closeTaskList,
  compareModalOpen,
  completePromptVisible,
  confirmCurrentTask,
  confirmCompare,
  confirmResetPrompt,
  confirmResetTask,
  confirmCompleteAxisAndContinue,
  confirmCompleteExperiment,
  confirmInstall,
  confirmReady,
  confirmedModalOpen,
  fixtureConfirmCountdown,
  fixtureConfirmCopy,
  fixtureConfirmModalOpen,
  fixtureConfirmSuccessModalOpen,
  currentAxisCompletion,
  currentExperimentTrayRows,
  currentTask,
  currentTaskFlow,
  hideRunningModal,
  installModalOpen,
  installActionLabel,
  laboratoryMqError,
  labName,
  openCompleteConfirm,
  openCompare,
  openInstall,
  openReady,
  openResetConfirm,
  openTaskList,
  pendingTaskCode,
  progressMessage,
  laboratoryTaskNotice,
  readyModalOpen,
  readyActionLabel,
  recentTasks,
  resetConfirmModalOpen,
  resetDangerModalOpen,
  runningExperiment,
  runningInteractionLocked,
  runningModalExperiment,
  runningModalVisible,
  scheduleRows,
  selectedTrayFlow,
  selectedTrayRow,
  setPendingTaskCode,
  setSelectedTrayCode,
  showRunningModal,
  summary,
  submitCompareScan,
  taskListModalOpen,
} = useLaboratoryPage({ selectedLabName });

const fullContentModalOpen = ref(false);
const fullContentDetail = ref(null);

const previewItems = (items, limit) => (Array.isArray(items) ? items.slice(0, limit) : []);
const overflowCount = (items, limit) => Math.max(0, (Array.isArray(items) ? items.length : 0) - limit);
const uniqueValues = (items) => Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean)));

const buildFullContentDetail = ({ experimentName, sampleCount, taskCode, trayRows }) => {
  const rows = Array.isArray(trayRows) ? trayRows : [];
  return {
    experimentName: String(experimentName || "").trim(),
    sampleCodes: uniqueValues(rows.flatMap((row) => (Array.isArray(row?.sampleCodes) ? row.sampleCodes : []))),
    sampleCount: Number.isFinite(Number(sampleCount)) ? Number(sampleCount) : 0,
    taskCode: String(taskCode || "").trim(),
    trayRows: rows,
  };
};

const openTaskRowFullContent = (row) => {
  fullContentDetail.value = buildFullContentDetail({
    experimentName: row?.experimentName,
    sampleCount: row?.sampleCount,
    taskCode: row?.taskCode,
    trayRows: row?.trayRows,
  });
  fullContentModalOpen.value = true;
};

const runningFullContent = computed(() =>
  buildFullContentDetail({
    experimentName: runningModalExperiment.value?.experimentName,
    sampleCount: runningModalExperiment.value?.sampleCodes?.length || 0,
    taskCode: runningModalExperiment.value?.taskCode,
    trayRows: runningModalExperiment.value?.trayRows,
  })
);

const openRunningFullContent = () => {
  fullContentDetail.value = runningFullContent.value;
  fullContentModalOpen.value = true;
};

const closeFullContentModal = () => {
  fullContentModalOpen.value = false;
};

const formatFlowTime = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace("T", " ")
    .replace(/\.\d{1,6}/, "")
    .replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
};
</script>
