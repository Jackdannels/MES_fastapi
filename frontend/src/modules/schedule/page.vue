<template>
  <Teleport v-if="canTeleportExceptionAction" to=".header-actions">
    <button
      class="action-btn schedule-header-action-button schedule-header-action-button--exception"
      :class="{ 'is-alert': pendingExceptionCount > 0 }"
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
        <div v-if="showAxisSelector" class="form-field schedule-axis-selector" data-testid="schedule-axis-selector">
          <label>{{ uiText.axis }}</label>
          <div class="schedule-axis-block">
            <div class="schedule-axis-caption">{{ uiText.axisRequirement }}</div>
            <div class="schedule-axis-options" aria-label="轴向要求">
              <span
                v-for="option in scheduleAxisRequirementOptions"
                :key="option.code"
                class="schedule-axis-chip is-active is-readonly"
                :data-testid="`schedule-axis-requirement-${option.testId}`"
              >
                {{ option.label }}
              </span>
            </div>
          </div>
          <div v-if="scheduleCompletedAxisOptions.length" class="schedule-axis-block">
            <div class="schedule-axis-caption">{{ uiText.axisCompleted }}</div>
            <div class="schedule-axis-options" aria-label="已完成轴向">
              <span
                v-for="option in scheduleCompletedAxisOptions"
                :key="option.code"
                class="schedule-axis-chip is-completed is-readonly"
                :data-testid="`schedule-axis-completed-${option.testId}`"
              >
                {{ option.label }}
              </span>
            </div>
          </div>
          <div class="schedule-axis-block">
            <div class="schedule-axis-caption">{{ uiText.axisCurrentSchedule }}</div>
            <div class="schedule-axis-options" role="group" aria-label="本次排程轴向">
              <button
                v-for="option in scheduleAxisOptions"
                :key="option.code"
                type="button"
                class="schedule-axis-chip"
                :class="{ 'is-active': isScheduleAxisSelected(option.code) }"
                :data-testid="`schedule-axis-option-${option.testId}`"
                :aria-pressed="isScheduleAxisSelected(option.code)"
                @click="toggleScheduleAxis(option.code)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div v-if="selectedAxisLabel" class="schedule-axis-order" data-testid="schedule-axis-order">
            {{ uiText.axisOrder }}{{ selectedAxisLabel }}
          </div>
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
            <option v-for="option in manualTimeSlotOptions" :key="option.value" :value="option.value" :disabled="option.disabled">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label>{{ uiText.plannedDuration }}</label>
          <div class="schedule-duration-control">
            <AppNumberInput
              v-model="scheduleForm.planned_hours"
              name="planned_hours"
              :min="scheduleForm.planned_duration_unit === 'days' ? 0.5 : 0.1"
              :max="scheduleForm.planned_duration_unit === 'days' ? PLANNED_DURATION_MAX_DAYS : PLANNED_DURATION_MAX_HOURS"
              :step="scheduleForm.planned_duration_unit === 'days' ? 0.5 : 0.1"
              :step-down="resolveDurationControlStep(scheduleForm, 'down')"
              :step-up="resolveDurationControlStep(scheduleForm, 'up')"
              inputmode="decimal"
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
                  : segment.displayMode === 'schedule-maintenance'
                  ? `gantt-segment-mixed-${segment.stackKey}`
                  : segment.scheduleId
                    ? `gantt-segment-${segment.scheduleId}`
                    : null
              "
              @click="!['stacked', 'split', 'schedule-maintenance'].includes(segment.displayMode) && segment.scheduleId && openTaskDetailModal(segment.scheduleId, segment.scheduleIds)"
            >
              <template v-if="['split', 'stacked', 'schedule-maintenance'].includes(segment.displayMode)">
                <div
                  :class="segment.className"
                  role="group"
                  :aria-label="segment.title"
                  :title="segment.title"
                  :style="segment.taskColor ? { '--gantt-task-color': segment.taskColor } : null"
                >
                  <span v-if="segment.displayMode === 'schedule-maintenance'" class="gantt-slot-content gantt-slot-content--mixed">
                    <template v-for="timelineItemType in segment.timelineOrder || ['task', 'maintenance']" :key="`${segment.key}-${timelineItemType}`">
                      <button
                        v-if="timelineItemType === 'task'"
                        class="gantt-task-item"
                        type="button"
                        :data-testid="segment.items[0]?.scheduleId ? `gantt-task-item-${segment.items[0].scheduleId}` : null"
                        :disabled="!segment.items[0]?.scheduleId"
                        :aria-label="segment.task?.title || segment.items[0]?.title"
                        :style="{ '--gantt-task-color': segment.items[0]?.color }"
                        :title="segment.task?.title || segment.items[0]?.title"
                        @click.stop="segment.items[0]?.scheduleId && openTaskDetailModal(segment.items[0].scheduleId, segment.items[0].scheduleIds)"
                      >
                        {{ segment.items[0]?.taskCode }}
                      </button>
                      <span
                        v-else
                        class="gantt-maintenance-item"
                        :aria-label="segment.maintenance?.title"
                        role="note"
                        :title="segment.maintenance?.title"
                      >
                        {{ segment.maintenance?.label }}
                      </span>
                    </template>
                  </span>
                  <span v-else class="gantt-slot-content">
                    <button
                      v-for="item in segment.items"
                      :key="`${segment.key}-${item.taskCode}`"
                      class="gantt-task-item"
                      type="button"
                      :data-testid="item.scheduleId ? `gantt-task-item-${item.scheduleId}` : null"
                      :disabled="!item.scheduleId"
                      :style="{ '--gantt-task-color': item.color }"
                      :title="item.title"
                      @click.stop="item.scheduleId && openTaskDetailModal(item.scheduleId, item.scheduleIds)"
                    >
                      {{ item.taskCode }}
                    </button>
                    <button
                      v-if="segment.displayMode === 'stacked' && segment.overflowCount > 0"
                      class="gantt-task-overflow"
                      type="button"
                      :data-testid="`gantt-overflow-${segment.stackKey}`"
                      :title="uiText.ganttOverflowTitle"
                      @click.stop="openGanttOverflowModal(segment)"
                    >
                      +{{ segment.overflowCount }}
                    </button>
                  </span>
                </div>
              </template>
              <button
                v-else
                :class="segment.className"
                type="button"
                :disabled="!segment.scheduleId"
                :title="segment.title"
                :style="segment.taskColor ? { '--gantt-task-color': segment.taskColor } : null"
              >
                {{ segment.label }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <AppModal :open="ganttOverflowOpen" :title="uiText.ganttOverflowTitle" data-testid="gantt-overflow-modal" @close="closeGanttOverflowModal">
    <div class="gantt-overflow-list">
      <button
        v-for="item in ganttOverflowDetail?.items || []"
        :key="item.scheduleId || item.title"
        class="gantt-overflow-row"
        type="button"
        :data-testid="item.scheduleId ? `gantt-overflow-task-${item.scheduleId}` : null"
        :disabled="!item.scheduleId"
        @click="item.scheduleId && openGanttOverflowTask(item.scheduleId, item.scheduleIds)"
      >
        <span class="gantt-overflow-row__main">{{ item.taskCode }}</span>
        <span class="gantt-overflow-row__meta">{{ item.experimentLabel || "-" }}</span>
        <span class="gantt-overflow-row__time">{{ item.timeRange || "-" }}</span>
      </button>
    </div>
  </AppModal>

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
      <AppPagination
        v-if="schedulePageCount > 1"
        :current-page="scheduleCurrentPage"
        :page-count="schedulePageCount"
        data-testid="schedule-pagination"
        @change="setSchedulePage"
      />
    </div>
    <table class="table" id="schedule-table">
      <thead>
        <tr>
          <th>{{ uiText.index }}</th>
          <th>{{ uiText.task }}</th>
          <th>{{ uiText.experimentCode }}</th>
          <th>{{ uiText.axis }}</th>
          <th>{{ uiText.device }}</th>
          <th>{{ uiText.startTime }}</th>
          <th>{{ uiText.endTime }}</th>
          <th>{{ uiText.status }}</th>
          <th>{{ uiText.actions }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="scheduleRows.length === 0">
          <td class="muted" colspan="9">{{ uiText.noScheduleRecords }}</td>
        </tr>
        <tr v-for="(row, index) in scheduleRows" :key="row.id">
          <td>{{ (scheduleCurrentPage - 1) * schedulePageSize + index + 1 }}</td>
          <td>{{ row.taskCode }}</td>
          <td>{{ row.experimentLabel || "-" }}</td>
          <td>{{ row.axisLabel || "-" }}</td>
          <td>{{ row.device }}</td>
          <td>
            <div>{{ row.startAt }}</div>
            <div
              v-if="row.scheduleIsDelayed"
              class="schedule-delay-meta"
              :class="{ 'is-conflict': row.scheduleHasDelayConflict }"
              :title="row.delay.title"
              :data-testid="`schedule-delay-${row.id}`"
            >
              <span class="schedule-delay-badge">{{ row.delayBadgeLabel }}</span>
              <span v-if="row.delay.originalStartAt">原 {{ row.delay.originalStartAt }}</span>
            </div>
          </td>
          <td>
            <div>{{ row.endAt }}</div>
            <div v-if="row.scheduleIsDelayed && row.delay.originalEndAt" class="schedule-delay-original">
              原 {{ row.delay.originalEndAt }}
            </div>
          </td>
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
        <label>{{ uiText.axis }}</label>
        <input :value="selectedTaskDetail.axisLabel" type="text" readonly />
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
    <AppFeedback :message="editWarning" tone="warning" data-testid="task-detail-warning" @close="editWarning = ''" />
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
    content-class="schedule-conflict-modal-content"
    :title="scheduleConflictDetail?.level === 'full' ? uiText.fullConflictTitle : uiText.partialConflictTitle"
    @close="cancelScheduleConflict"
  >
    <div
      v-if="scheduleConflictDetail"
      class="schedule-conflict-panel"
      :class="scheduleConflictDetail.level === 'full' ? 'is-full' : 'is-partial'"
      aria-label="冲突排程详情，可上下滚动"
      data-testid="schedule-conflict-modal"
      role="region"
      tabindex="0"
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
          <div class="schedule-exception-card__meta">触发时间：{{ formatLocalDateTime(row.created_at) || "-" }}</div>
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
          <AppNumberInput
            v-model="editForm.planned_hours"
            name="edit_planned_hours"
            :min="editForm.planned_duration_unit === 'days' ? 0.5 : 0.1"
            :max="editForm.planned_duration_unit === 'days' ? PLANNED_DURATION_MAX_DAYS : PLANNED_DURATION_MAX_HOURS"
            :step="editForm.planned_duration_unit === 'days' ? 0.5 : 0.1"
            :step-down="resolveDurationControlStep(editForm, 'down')"
            :step-up="resolveDurationControlStep(editForm, 'up')"
            inputmode="decimal"
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
import AppNumberInput from "@/components/shared/AppNumberInput.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";
import { formatLocalDateTime } from "@/lib/dateTime";
import { useSchedulePage } from "./useSchedulePage";

const uiText = {
  actions: "操作",
  afternoonShort: "下午 12:00-18:00",
  afternoonSlot: "下午（12:00-18:00）",
  axis: "轴向",
  axisCompleted: "已完成",
  axisCurrentSchedule: "剩余轴向",
  axisOrder: "顺序：",
  axisRequirement: "轴向要求",
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
  ganttOverflowTitle: "折叠任务",
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

const resolveDurationControlStep = (form, direction) => {
  if (form?.planned_duration_unit === "days") {
    return 0.5;
  }
  const value = Number.parseFloat(String(form?.planned_hours ?? ""));
  if (!Number.isFinite(value)) {
    return 0.1;
  }
  return direction === "down"
    ? (value <= 0.5 ? 0.1 : 0.5)
    : (value < 0.5 ? 0.1 : 0.5);
};

const {
  acknowledgeException,
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
  ganttOverflowDetail,
  ganttOverflowOpen,
  showNextGanttWindow,
  showPreviousGanttWindow,
  manualLabOptionItems,
  manualTimeSlotOptions,
  openExceptionModal,
  openGanttOverflowModal,
  openGanttOverflowTask,
  openScheduleDrawer,
  openTaskDetailModal,
  pendingExceptionCount,
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
  scheduleCurrentPage,
  schedulePageCount,
  schedulePageSize,
  scheduleAxisRequirementOptions,
  scheduleCompletedAxisOptions,
  scheduleAxisOptions,
  scheduleRows,
  scheduleSearch,
  scheduleWarning,
  maintenanceLabNotice,
  PLANNED_DURATION_MAX_DAYS,
  PLANNED_DURATION_MAX_HOURS,
  setSchedulePage,
  submitSchedule,
  summaryCards,
  taskOptions,
  taskScheduledOverlays,
  isScheduleAxisSelected,
  selectedAxisLabel,
  showAxisSelector,
  toggleScheduleAxis,
  closeGanttOverflowModal,
  resetScheduleForm,
} = useSchedulePage();

const canTeleportExceptionAction = computed(() => typeof document !== "undefined" && Boolean(document.querySelector(".header-actions")));
</script>
