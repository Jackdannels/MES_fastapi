<template>
  <Teleport v-if="canTeleportExceptionAction" to=".header-actions">
    <button
      class="action-btn schedule-header-action-button schedule-header-action-button--exception"
      data-testid="schedule-exception-action"
      type="button"
      @click="openExceptionModal"
    >
      {{ exceptionActionLabel }}
    </button>
  </Teleport>

  <section class="card section">
    <h3>{{ uiText.manualTitle }}</h3>
    <form @submit.prevent="submitSchedule">
      <div class="form-grid">
        <div class="form-field">
          <label>{{ uiText.taskCode }}</label>
          <select v-model="scheduleForm.task_code" name="task_code">
            <option value="">{{ taskOptions.length ? uiText.selectAcceptedTask : uiText.noAcceptedTask }}</option>
            <option v-for="option in taskOptions" :key="option.code" :value="option.code">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label>{{ uiText.experimentCode }}</label>
          <select v-model="scheduleForm.experiment_code" name="experiment_code">
            <option value="">{{ experimentOptions.length ? uiText.selectExperiment : uiText.selectTaskFirst }}</option>
            <option v-for="option in experimentOptions" :key="option.code" :value="option.code" :title="option.fullCode || option.code">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label>{{ uiText.lab }}</label>
          <select v-model="scheduleForm.device" name="device">
            <option value="">{{ manualLabOptionItems.length ? uiText.selectLab : uiText.selectTaskFirst }}</option>
            <option
              v-for="option in manualLabOptionItems"
              :key="option.value"
              :disabled="option.disabled"
              :title="option.title"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <div v-if="maintenanceLabNotice" class="muted schedule-maintenance-hint" data-testid="schedule-maintenance-hint">
            {{ maintenanceLabNotice }}
          </div>
        </div>
        <div class="form-field">
          <label>{{ uiText.scheduleDate }}</label>
          <PickerOnlyInput v-model="scheduleForm.schedule_date" type="date" name="schedule_date" />
        </div>
        <div class="form-field">
          <label>{{ uiText.timeSlot }}</label>
          <select v-model="scheduleForm.time_slot" name="time_slot">
            <option v-for="option in manualTimeSlotOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label>{{ uiText.plannedDuration }}</label>
          <div class="schedule-duration-control">
            <input
              v-model="scheduleForm.planned_hours"
              type="number"
              name="planned_hours"
              :min="0.5"
              :step="0.5"
            />
            <div class="schedule-duration-toggle" role="group" :aria-label="uiText.durationUnitLabel">
              <button
                type="button"
                name="planned_duration_unit"
                data-testid="schedule-duration-unit-hours"
                class="schedule-duration-toggle__button"
                :class="{ 'is-active': scheduleForm.planned_duration_unit === 'hours' }"
                @click="setScheduleDurationUnit('hours')"
              >
                {{ uiText.durationUnitHours }}
              </button>
              <button
                type="button"
                data-testid="schedule-duration-unit-days"
                class="schedule-duration-toggle__button"
                :class="{ 'is-active': scheduleForm.planned_duration_unit === 'days' }"
                @click="setScheduleDurationUnit('days')"
              >
                {{ uiText.durationUnitDays }}
              </button>
            </div>
          </div>
        </div>
        <div class="form-field" :class="{ 'is-hidden': scheduleForm.time_slot !== 'custom' }">
          <label>{{ uiText.startTime }}</label>
          <PickerOnlyInput v-model="scheduleForm.custom_start" type="time" name="custom_start" :min="scheduleCustomStartMinTime" />
        </div>
      </div>
      <div class="form-actions">
        <button class="action-btn" type="button" data-testid="schedule-submit" @click="submitSchedule">{{ uiText.confirmSchedule }}</button>
        <button class="action-btn secondary" type="button" @click="resetScheduleForm">{{ uiText.clear }}</button>
      </div>
      <AppFeedback :message="scheduleWarning" tone="warning" @close="scheduleWarning = ''" />
    </form>
  </section>

  <section class="card section">
    <h3>{{ uiText.ganttTitle }}</h3>
    <div v-if="taskScheduledOverlays.length" class="schedule-task-overlays" data-testid="schedule-task-overlays">
      <div class="schedule-task-overlays__title">{{ uiText.currentTaskScheduledTitle }}</div>
      <div class="schedule-task-overlays__list">
        <article
          v-for="overlay in taskScheduledOverlays"
          :key="overlay.scheduleId"
          class="schedule-task-overlay-card"
          :data-testid="`schedule-task-overlay-${overlay.scheduleId}`"
        >
          <div class="schedule-task-overlay-card__head">
            <strong>{{ overlay.experimentLabel }}</strong>
            <span>{{ overlay.device }}</span>
          </div>
          <div class="schedule-task-overlay-card__meta">{{ overlay.timeLabel }}</div>
          <div class="schedule-task-overlay-card__chips">
            <span v-for="trayNo in overlay.trayNos" :key="trayNo" class="schedule-task-overlay-chip">{{ trayNo }}</span>
            <span v-if="overlay.trayNos.length === 0" class="schedule-task-overlay-chip is-muted">{{ uiText.noTraySummary }}</span>
          </div>
        </article>
      </div>
    </div>
    <div class="gantt-wrap">
      <table class="gantt" id="gantt-table">
        <thead>
          <tr>
            <th rowspan="2" class="gantt-sticky">{{ uiText.lab }}</th>
            <th
              v-for="(day, dayIndex) in ganttView.days"
              :key="day.key"
              colspan="2"
              class="gantt-day-heading"
            >
              <button
                v-if="dayIndex === 0"
                class="gantt-window-nav gantt-window-nav--home"
                type="button"
                :disabled="!canResetGanttWindow"
                :aria-label="uiText.resetGanttWindow"
                :title="uiText.resetGanttWindow"
                @click="resetGanttWindow"
              >
                «
              </button>
              <button
                v-if="dayIndex === 0"
                class="gantt-window-nav gantt-window-nav--prev"
                type="button"
                :disabled="!canShowPreviousGanttWindow"
                :aria-label="uiText.previousGanttWindow"
                :title="uiText.previousGanttWindow"
                @click="showPreviousGanttWindow"
              >
                ‹
              </button>
              <span>{{ day.label }}</span>
              <button
                v-if="dayIndex === ganttView.days.length - 1"
                class="gantt-window-nav gantt-window-nav--next"
                type="button"
                :aria-label="uiText.nextGanttWindow"
                :title="uiText.nextGanttWindow"
                @click="showNextGanttWindow"
              >
                ›
              </button>
            </th>
          </tr>
          <tr>
            <template v-for="day in ganttView.days" :key="`${day.key}-slots`">
              <th>{{ uiText.morningShort }}</th>
              <th>{{ uiText.afternoonShort }}</th>
            </template>
          </tr>
        </thead>
        <tbody id="gantt-body">
          <tr v-if="ganttView.rows.length === 0">
            <td class="muted" :colspan="ganttView.days.length * 2 + 1">{{ uiText.noDevices }}</td>
          </tr>
          <tr v-for="row in ganttView.rows" :key="row.device">
            <td class="gantt-sticky">
              <span class="gantt-lab-name">{{ row.device }}</span>
            </td>
            <td
              v-for="segment in row.segments"
              :key="segment.key"
              :colspan="segment.colspan"
              :data-testid="
                segment.displayMode === 'split'
                  ? `gantt-segment-split-${segment.stackKey}`
                  : segment.displayMode === 'stacked'
                  ? `gantt-segment-stack-${segment.stackKey}`
                  : segment.scheduleId
                    ? `gantt-segment-${segment.scheduleId}`
                    : null
              "
              @click="segment.displayMode !== 'stacked' && segment.displayMode !== 'split' && segment.scheduleId && openTaskDetailModal(segment.scheduleId)"
            >
              <button
                :class="segment.className"
                type="button"
                :disabled="segment.displayMode === 'stacked' || segment.displayMode === 'split' ? true : !segment.scheduleId"
                :title="segment.title"
                :style="segment.taskColor ? { '--gantt-task-color': segment.taskColor } : null"
              >
                <template v-if="segment.displayMode === 'split' || segment.displayMode === 'stacked'">
                  <span class="gantt-slot-content">
                    <span
                      v-for="item in segment.items"
                      :key="`${segment.key}-${item.taskCode}`"
                      class="gantt-task-item"
                      :style="{ '--gantt-task-color': item.color }"
                    >
                      {{ item.taskCode }}
                    </span>
                    <span v-if="segment.displayMode === 'stacked' && segment.overflowCount > 0" class="gantt-task-overflow">+{{ segment.overflowCount }}</span>
                  </span>
                </template>
                <template v-else-if="segment.displayMode === 'single'">{{ segment.label }}</template>
                <template v-else>
                  {{ segment.label }}
                </template>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="section">
    <div class="card">
      <h3>{{ uiText.nextSchedule }}</h3>
      <div class="muted">{{ uiText.nextScheduleHint }}</div>
      <div class="kpi">{{ summaryCards.nextAuto }}</div>
    </div>
  </section>

  <section class="card section">
    <h3>{{ uiText.scheduleList }}</h3>
    <div class="toolbar">
      <input v-model="scheduleSearch" class="search-input" :placeholder="uiText.scheduleSearchPlaceholder" />
    </div>
    <table class="table" id="schedule-table">
      <thead>
        <tr>
          <th>{{ uiText.index }}</th>
          <th>{{ uiText.task }}</th>
          <th>{{ uiText.experimentCode }}</th>
          <th>{{ uiText.device }}</th>
          <th>{{ uiText.startTime }}</th>
          <th>{{ uiText.endTime }}</th>
          <th>{{ uiText.status }}</th>
          <th>{{ uiText.actions }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="scheduleRows.length === 0">
          <td class="muted" colspan="8">{{ uiText.noScheduleRecords }}</td>
        </tr>
        <tr v-for="(row, index) in scheduleRows" :key="row.id">
          <td>{{ index + 1 }}</td>
          <td>{{ row.taskCode }}</td>
          <td>{{ row.experimentLabel || "-" }}</td>
          <td>{{ row.device }}</td>
          <td>{{ row.startAt }}</td>
          <td>{{ row.endAt }}</td>
          <td><span :class="row.rowStatusClass">{{ row.rowStatus }}</span></td>
          <td>
            <button
              class="action-link"
              type="button"
              :data-testid="`open-schedule-drawer-${index}`"
              @click="openScheduleDrawer(row.id)"
            >
              {{ uiText.edit }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <AppModal :open="taskDetailModalOpen" :title="uiText.taskDetailTitle" @close="closeTaskDetailModal">
    <div v-if="selectedTaskDetail" class="form-grid">
      <div class="form-field">
        <label>{{ uiText.taskCode }}</label>
        <input :value="selectedTaskDetail.code" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.taskName }}</label>
        <input :value="selectedTaskDetail.name" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.experimentCode }}</label>
        <input :value="selectedTaskDetail.experimentCode" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.experimentLabel }}</label>
        <input :value="selectedTaskDetail.experimentLabel" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.testType }}</label>
        <input :value="selectedTaskDetail.testType" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.source }}</label>
        <input :value="selectedTaskDetail.source" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.priority }}</label>
        <input :value="selectedTaskDetail.priority" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.status }}</label>
        <input :value="selectedTaskDetail.status" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.lab }}</label>
        <input :value="selectedTaskDetail.device" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.startTime }}</label>
        <input :value="selectedTaskDetail.startAt" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.plannedHours }}</label>
        <input :value="selectedTaskDetail.plannedHours" type="text" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.estimatedCompletionTime }}</label>
        <input :value="selectedTaskDetail.estimatedEndAt" type="text" readonly />
      </div>
    </div>
    <template #footer>
      <button
        v-if="selectedTaskDetail"
        class="action-btn secondary"
        type="button"
        data-testid="task-detail-delete"
        @click="removeTaskDetailSchedule"
      >
        {{ uiText.deleteSchedule }}
      </button>
      <button
        v-if="selectedTaskDetail"
        class="action-btn"
        type="button"
        data-testid="task-detail-reschedule"
        @click="rescheduleFromTaskDetail"
      >
        {{ uiText.deleteThenReschedule }}
      </button>
    </template>
  </AppModal>

  <AppModal
    :open="scheduleConflictOpen"
    :title="scheduleConflictDetail?.level === 'full' ? uiText.fullConflictTitle : uiText.partialConflictTitle"
    @close="cancelScheduleConflict"
  >
    <div
      v-if="scheduleConflictDetail"
      class="schedule-conflict-panel"
      :class="scheduleConflictDetail.level === 'full' ? 'is-full' : 'is-partial'"
      data-testid="schedule-conflict-modal"
    >
      <div class="schedule-conflict-panel__summary">
        <strong>{{ scheduleConflictDetail.level === "full" ? uiText.fullConflictTitle : uiText.partialConflictTitle }}</strong>
        <span>{{ uiText.conflictTaskLabel }}{{ scheduleConflictDetail.taskCode }}</span>
        <span>{{ uiText.conflictCandidateLabel }}{{ scheduleConflictDetail.candidateExperimentLabel }}</span>
      </div>
      <div class="schedule-conflict-panel__tray-block">
        <div class="schedule-conflict-panel__label">{{ uiText.conflictTrayLabel }}</div>
        <div class="schedule-conflict-panel__chips">
          <span v-for="trayNo in scheduleConflictDetail.conflictTrayNos" :key="trayNo" class="schedule-conflict-chip">
            {{ trayNo }}
          </span>
        </div>
      </div>
      <div class="schedule-conflict-panel__list">
        <article
          v-for="conflict in scheduleConflictDetail.conflictSchedules"
          :key="conflict.scheduleId"
          class="schedule-conflict-row"
        >
          <div class="schedule-conflict-row__head">
            <strong>{{ conflict.experimentLabel }}</strong>
            <span>{{ conflict.device }}</span>
          </div>
          <div class="schedule-conflict-row__meta">{{ conflict.overlapRange }}</div>
          <div class="schedule-conflict-panel__chips">
            <span v-for="trayNo in conflict.trayNos" :key="`${conflict.scheduleId}-${trayNo}`" class="schedule-conflict-chip is-related">
              {{ trayNo }}
            </span>
          </div>
        </article>
      </div>
    </div>
    <template #footer>
      <button class="action-btn secondary" type="button" data-testid="schedule-conflict-cancel" @click="cancelScheduleConflict">
        {{ uiText.cancelConflictSchedule }}
      </button>
      <button class="action-btn" type="button" data-testid="schedule-conflict-confirm" @click="confirmScheduleConflict">
        {{ uiText.confirmConflictSchedule }}
      </button>
    </template>
  </AppModal>

  <AppModal :open="exceptionModalOpen" title="异常处理" data-testid="schedule-exception-modal" @close="closeExceptionModal">
    <div class="schedule-exception-panel">
      <div v-if="pendingExceptionRows.length === 0" class="muted">当前暂无待确认异常。</div>
      <div v-else class="schedule-exception-list">
        <article
          v-for="row in pendingExceptionRows"
          :key="row.id"
          class="schedule-exception-card"
          :data-testid="`schedule-exception-row-${row.id}`"
        >
          <div class="schedule-exception-card__head">
            <strong>{{ row.task_code || "-" }}</strong>
            <span>{{ row.device || "-" }}</span>
          </div>
          <div class="schedule-exception-card__reason">{{ row.reason }}</div>
          <div class="schedule-exception-card__detail">{{ row.detail || "-" }}</div>
          <div class="schedule-exception-card__meta">触发时间：{{ row.created_at ? row.created_at.replace("T", " ").replace(".000Z", "") : "-" }}</div>
          <div class="schedule-exception-card__actions">
            <button
              class="action-btn schedule-header-action-button schedule-header-action-button--exception"
              type="button"
              :data-testid="`schedule-exception-acknowledge-${row.id}`"
              @click="acknowledgeException(row.id)"
            >
              确认
            </button>
          </div>
        </article>
      </div>
    </div>
  </AppModal>

  <AppDrawer :open="scheduleDrawerOpen" :title="uiText.editScheduleTitle" @close="closeScheduleDrawer">
    <form class="form-grid" @submit.prevent="saveSchedule">
      <div class="form-field">
        <label>{{ uiText.taskCode }}</label>
        <input v-model="editForm.task_code" type="text" name="task_code" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.experimentCode }}</label>
        <input v-model="editForm.experiment_code" type="text" name="experiment_code" readonly />
      </div>
      <div class="form-field">
        <label>{{ uiText.lab }}</label>
        <select v-model="editForm.device" name="device" data-testid="schedule-edit-device">
          <option value="">{{ uiText.selectLab }}</option>
          <option
            v-for="option in buildEditLabOptionItems(editForm.device, editForm.task_code)"
            :key="option.value"
            :disabled="option.disabled"
            :title="option.title"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>
      <div class="form-field">
        <label>{{ uiText.scheduleDate }}</label>
        <PickerOnlyInput v-model="editForm.schedule_date" type="date" name="schedule_date" />
      </div>
      <div class="form-field">
        <label>{{ uiText.timeSlot }}</label>
        <select v-model="editForm.time_slot" name="time_slot">
          <option value="morning">{{ uiText.morningSlot }}</option>
          <option value="afternoon">{{ uiText.afternoonSlot }}</option>
          <option value="custom">{{ uiText.customSlot }}</option>
        </select>
      </div>
      <div class="form-field">
        <label>{{ uiText.plannedDuration }}</label>
        <div class="schedule-duration-control">
          <input
            v-model="editForm.planned_hours"
            type="number"
            name="edit_planned_hours"
            :min="0.5"
            :step="0.5"
          />
          <div class="schedule-duration-toggle" role="group" :aria-label="uiText.durationUnitLabel">
            <button
              type="button"
              name="edit_planned_duration_unit"
              data-testid="edit-duration-unit-hours"
              class="schedule-duration-toggle__button"
              :class="{ 'is-active': editForm.planned_duration_unit === 'hours' }"
              @click="setEditDurationUnit('hours')"
            >
              {{ uiText.durationUnitHours }}
            </button>
            <button
              type="button"
              data-testid="edit-duration-unit-days"
              class="schedule-duration-toggle__button"
              :class="{ 'is-active': editForm.planned_duration_unit === 'days' }"
              @click="setEditDurationUnit('days')"
            >
              {{ uiText.durationUnitDays }}
            </button>
          </div>
        </div>
      </div>
      <div class="form-field" :class="{ 'is-hidden': editForm.time_slot !== 'custom' }">
        <label>{{ uiText.startTime }}</label>
        <PickerOnlyInput v-model="editForm.custom_start" type="time" name="custom_start" :min="editCustomStartMinTime" />
      </div>
      <AppFeedback :message="editWarning" tone="warning" style="grid-column: 1 / -1;" @close="editWarning = ''" />
      <div class="form-actions" style="grid-column: 1 / -1;">
        <button class="action-btn" type="button" data-testid="schedule-update" @click="saveSchedule">{{ uiText.saveChanges }}</button>
        <button class="action-btn secondary" type="button" data-testid="schedule-delete" @click="removeSchedule">
          {{ uiText.deleteSchedule }}
        </button>
      </div>
    </form>
  </AppDrawer>
</template>

<script setup>
defineOptions({
  name: "SchedulePage",
});

import { computed } from "vue";

import AppDrawer from "@/components/shared/AppDrawer.vue";
import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppModal from "@/components/shared/AppModal.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";
import { useSchedulePage } from "./useSchedulePage";

const uiText = {
  actions: "操作",
  afternoonShort: "下午 12:00-18:00",
  afternoonSlot: "下午（12:00-18:00）",
  cancelConflictSchedule: "取消排程",
  clear: "重置",
  conflictCandidateLabel: "当前实验：",
  conflictTaskLabel: "当前任务：",
  conflictTrayLabel: "冲突托盘",
  confirmSchedule: "确认排程",
  confirmConflictSchedule: "确认排程",
  currentTime: "当前时间",
  currentTaskScheduledTitle: "当前任务已排程",
  customSlot: "自定义",
  deleteThenReschedule: "删除后重新排程",
  deleteSchedule: "删除排程",
  device: "设备",
  durationUnitLabel: "预计实验时长单位",
  durationUnitDays: "天数",
  durationUnitHours: "小时",
  edit: "编辑",
  editScheduleTitle: "排程编辑",
  endTime: "结束时间",
  estimatedCompletionTime: "预计完成时间",
  experimentCode: "实验类型",
  experimentLabel: "实验标签",
  fullConflictTitle: "完全冲突提示",
  ganttTitle: "设备空闲排程（上午/下午）",
  index: "序号",
  lab: "实验室",
  manualTitle: "手动排程",
  morningShort: "上午 08:00-12:00",
  morningSlot: "上午（08:00-12:00）",
  nextSchedule: "下一次排程提示",
  nextScheduleHint: "基于设备空闲与样品到样",
  noAcceptedTask: "暂无已接收任务",
  noDevices: "暂无设备",
  nextGanttWindow: "后三天",
  nextLabSchedule: "跳转到该实验室下一个实验",
  noScheduleRecords: "暂无排程记录",
  noTraySummary: "未记录托盘",
  partialConflictTitle: "部分冲突提示",
  plannedDuration: "预计实验时长",
  plannedHours: "预计实验时长（小时）",
  previousGanttWindow: "前三天",
  previousLabSchedule: "跳转到该实验室上一个实验",
  priority: "优先级",
  saveChanges: "保存修改",
  scheduleDate: "排程日期",
  resetGanttWindow: "回到当前日期",
  scheduleList: "排程清单",
  scheduleSearchPlaceholder: "筛选任务/设备/时间",
  selectAcceptedTask: "请选择已接收任务",
  selectExperiment: "请选择实验类型",
  selectLab: "请选择实验室",
  selectTaskFirst: "请先选择任务",
  source: "任务来源",
  startTime: "开始时间",
  status: "状态",
  task: "任务",
  taskCode: "任务编号",
  taskDetailTitle: "任务详情",
  taskName: "任务名称",
  testType: "试验类型",
  timeSlot: "时段",
};

const {
  acknowledgeException,
  buildEditLabOptions,
  buildEditLabOptionItems,
  cancelScheduleConflict,
  canResetGanttWindow,
  canShowPreviousGanttWindow,
  closeExceptionModal,
  closeScheduleDrawer,
  closeTaskDetailModal,
  confirmScheduleConflict,
  editForm,
  editCustomStartMinTime,
  editWarning,
  exceptionActionLabel,
  exceptionModalOpen,
  experimentOptions,
  ganttView,
  showNextGanttWindow,
  showPreviousGanttWindow,
  manualLabOptions,
  manualLabOptionItems,
  manualTimeSlotOptions,
  openExceptionModal,
  openScheduleDrawer,
  openTaskDetailModal,
  pendingExceptionRows,
  removeSchedule,
  removeTaskDetailSchedule,
  rescheduleFromTaskDetail,
  resetGanttWindow,
  selectedTaskDetail,
  saveSchedule,
  setEditDurationUnit,
  setScheduleDurationUnit,
  scheduleConflictDetail,
  scheduleConflictOpen,
  taskDetailModalOpen,
  scheduleDrawerOpen,
  scheduleForm,
  scheduleCustomStartMinTime,
  scheduleRows,
  scheduleSearch,
  scheduleWarning,
  maintenanceLabNotice,
  submitSchedule,
  summaryCards,
  taskOptions,
  taskScheduledOverlays,
  resetScheduleForm,
} = useSchedulePage();

const canTeleportExceptionAction = computed(() => typeof document !== "undefined" && Boolean(document.querySelector(".header-actions")));
</script>
