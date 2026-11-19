<template>
  <div class="sample-group-panel" :data-testid="view.prefix + '-panel'" :aria-busy="samplesFlow.loading">
    <section class="card section sample-group-toolbar" :aria-label="view.title">
      <label class="sample-group-filter sample-group-search">
        <span>关键词</span>
        <input
          :value="view.query"
          class="search-input"
          type="search"
          placeholder="任务号、样品号、托盘号、位置或状态"
          :data-testid="view.prefix + '-search'"
          @input="view.setQuery($event.target.value)"
        />
      </label>
      <label class="sample-group-filter">
        <span>任务</span>
        <select :value="view.task" class="search-input" :data-testid="view.prefix + '-task-filter'" @change="view.setTask($event.target.value)">
          <option value="">全部任务</option>
          <option v-for="task in view.tasks" :key="task" :value="task">{{ task }}</option>
        </select>
      </label>
      <label class="sample-group-filter">
        <span>样品状态</span>
        <select :value="view.status" class="search-input" :data-testid="view.prefix + '-status-filter'" @change="view.setStatus($event.target.value)">
          <option value="">全部状态</option>
          <option v-for="status in view.statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <p v-if="!staging && samplesFlow.fullSamplesLoaded" class="sample-group-capacity muted">
        剩余托盘 / 总托盘 {{ trayCapacityText }}
      </p>
    </section>

    <div class="sample-group-layout">
      <section class="card sample-group-catalog">
        <header class="sample-group-heading">
          <h3>{{ view.title }}</h3>
          <p v-if="staging" class="muted">{{ linkedGroupCount }} 个托盘 · {{ view.rows.length }} 条样品</p>
          <dl v-else class="sample-group-totals" aria-live="polite" aria-atomic="true" data-testid="samples-flow-totals">
            <div>
              <dt>任务总数</dt>
              <dd>{{ taskTotals.total }}</dd>
            </div>
            <div>
              <dt>已分配托盘任务数</dt>
              <dd class="sample-group-assigned-total">{{ taskTotals.assigned }}</dd>
            </div>
            <div>
              <dt>样品总数</dt>
              <dd>{{ view.rows.length }}</dd>
            </div>
          </dl>
        </header>
        <div
          ref="trayScroll"
          class="sample-group-list"
          role="region"
          aria-label="任务与托盘分组"
          tabindex="0"
          data-testid="samples-group-tray-list"
        >
          <p v-if="!groups.length" class="muted sample-group-empty">{{ samplesFlow.loading ? "加载中…" : "暂无匹配的样品" }}</p>
          <ul v-else class="sample-group-items">
            <li
              v-for="(task, index) in taskGroups"
              :key="task.code"
              class="sample-group-item"
              :class="{ 'sample-group-item--direct': !task.expandable }"
              :data-assigned="task.trayCount > 0"
            >
              <button
                type="button"
                class="sample-group-choice sample-task-choice"
                :data-assigned="task.trayCount > 0"
                :aria-current="task.expandable && selectedGroup?.taskCode === task.code ? 'true' : undefined"
                :aria-pressed="task.expandable ? undefined : task.groups[0].key === selectedGroup?.key"
                :aria-expanded="task.expandable ? isTaskExpanded(task) : undefined"
                :aria-controls="task.expandable ? view.prefix + '-task-trays-' + index : undefined"
                @click="toggleTask(task)"
              >
                <strong class="sample-group-list-task">{{ task.code || "未关联任务" }}</strong>
                <span v-if="task.expandable" class="sample-task-expand-icon" aria-hidden="true"></span>
                <span v-else class="sample-group-list-count">{{ task.sampleCount }} 件</span>
                <span v-if="task.expandable" class="sample-task-counts muted">
                  {{ task.trayCount }} 个{{ task.isPartial ? "匹配" : "" }}托盘 · {{ task.sampleCount }} 件样品
                  <span v-if="task.hasUnassigned"> · 含未分配样品</span>
                </span>
                <span v-else class="sample-group-list-tray muted">{{ task.groups[0].trayCode || "未关联托盘" }}</span>
              </button>
              <button
                v-if="!task.expandable && task.trayCount"
                type="button"
                class="sample-group-view-flow action-link"
                :aria-label="'查看流程图，托盘 ' + task.groups[0].trayCode"
                @click="openTrayFlow(task.groups[0])"
              >
                查看流程图
              </button>
              <ul
                v-if="task.expandable"
                v-show="isTaskExpanded(task)"
                :id="view.prefix + '-task-trays-' + index"
                class="sample-task-trays"
              >
                <li
                  v-for="group in task.groups"
                  :key="group.key"
                  class="sample-group-tray-item"
                  :data-assigned="Boolean(group.trayCode)"
                >
                  <button
                    type="button"
                    class="sample-group-choice sample-group-tray-choice"
                    :data-assigned="Boolean(group.trayCode)"
                    :aria-pressed="group.key === selectedGroup?.key"
                    @click="selectGroup(group)"
                  >
                    <strong class="sample-group-list-task">{{ group.trayCode || "未关联托盘" }}</strong>
                    <span class="sample-group-list-count">{{ group.samples.length }} 件</span>
                  </button>
                  <button
                    v-if="group.trayCode"
                    type="button"
                    class="sample-group-view-flow action-link"
                    :aria-label="'查看流程图，托盘 ' + group.trayCode"
                    @click="openTrayFlow(group)"
                  >
                    查看流程图
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="active && selectedGroup" class="card sample-group-detail" aria-label="所选样品分组">
        <header class="sample-group-heading">
          <h3 data-testid="samples-group-selected-code">{{ selectedGroup.trayCode || "未关联托盘" }}</h3>
          <span v-if="selectedTrayFlow?.status" :class="resolveStatusClass(selectedTrayFlow.status)">{{ selectedTrayFlow.status }}</span>
        </header>

        <div class="sample-group-flows" data-testid="samples-group-flows">
          <section v-if="selectedGroup.taskCode" class="sample-group-flow sample-group-task-flow" aria-label="任务流程图" data-testid="samples-group-task-flow">
            <div class="sample-group-flow-heading">
              <h4>任务流程图</h4>
              <span class="muted">任务号 <strong class="sample-group-task-number">{{ selectedGroup.taskCode || "-" }}</strong></span>
              <strong class="sample-group-flow-summary" data-testid="samples-group-task-flow-status">{{ selectedTaskFlow.currentStatus }}</strong>
            </div>
            <ol class="sample-flow-unified">
              <li
                v-for="(step, index) in selectedTaskFlow.steps"
                :key="step.key"
                :data-flow-step="index"
                :data-testid="'samples-group-task-step-' + step.key"
                :aria-current="step.active ? 'step' : undefined"
                :class="{ current: step.active, reached: step.reached }"
              >
                <span class="sample-flow-label">{{ step.label }}</span>
              </li>
            </ol>
          </section>

          <section v-if="selectedTrayFlow" class="sample-group-flow sample-group-tray-flow" aria-label="统一托盘流程图" data-testid="samples-group-tray-flow">
            <div class="sample-group-flow-heading">
              <h4>统一托盘流程图</h4>
            </div>
            <p v-if="selectedTrayFlow.displayRemark" class="sample-flow-status" data-testid="samples-group-tray-remark">
              备注：{{ selectedTrayFlow.displayRemark }}
            </p>
            <TrayFlowTimeline :steps="selectedTrayFlow.steps" test-prefix="samples-group-tray-step-" />
          </section>
        </div>

        <section class="sample-group-samples" aria-label="关联样品">
          <header class="sample-group-heading">
            <h4>关联样品</h4>
            <span class="muted" data-testid="samples-group-sample-count">
              {{ hasAdditionalTraySamples ? `匹配 ${selectedGroup.samples.length} 条 / 全盘 ${fullTraySamples.length} 条` : `共 ${selectedGroup.samples.length} 条` }}
            </span>
            <button
              v-if="hasAdditionalTraySamples"
              type="button"
              class="sample-group-view-all action-link"
              :aria-pressed="showAllTraySamples"
              data-testid="samples-group-view-all"
              @click="showAllTraySamples = !showAllTraySamples"
            >
              {{ showAllTraySamples ? "只看匹配样品" : "查看全盘样品" }}
            </button>
          </header>
          <div
            ref="sampleScroll"
            class="sample-group-sample-scroll"
            role="region"
            aria-label="分组内样品列表"
            tabindex="0"
            data-testid="samples-group-sample-list"
          >
            <table class="table sample-group-sample-table">
              <thead>
                <tr>
                  <th scope="col">样品编号</th>
                  <th scope="col">当前位置</th>
                  <th scope="col">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sample in visibleSamples" :key="sample.id || sample.code" data-testid="samples-group-sample-row">
                  <td><span class="sample-group-cell sample-group-sample-code" :title="sample.code">{{ sample.code }}</span></td>
                  <td><span class="sample-group-cell" :title="sample.location">{{ sample.location || "-" }}</span></td>
                  <td><span :class="[sample.statusClass, 'sample-group-cell']" :title="sample.status">{{ sample.status || "-" }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
      <section v-else class="card sample-group-detail sample-group-empty" aria-label="所选样品分组">
        <p class="muted">{{ samplesFlow.loading ? "正在加载样品" : "暂无可查看的分组" }}</p>
      </section>
    </div>
    <AppFeedback :message="samplesFlow.warning || flowWarning" tone="warning" @close="clearWarning" />
    <TrayFlowDialog
      :open="active && Boolean(flowDialogKey && flowDialogKey === selectedGroup?.key)"
      :tray-code="selectedGroup?.trayCode"
      :flow="selectedTrayFlow"
      @close="flowDialogKey = ''"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import AppFeedback from "@/components/shared/AppFeedback.vue";
import { getRemainingSystemTrayCount, SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import TrayFlowDialog from "./TrayFlowDialog.vue";
import TrayFlowTimeline from "./TrayFlowTimeline.vue";
import { DEFAULT_LABELS } from "./sampleFlow.constants";
import { resolveSampleTableTrayCodes, resolveStatusClass } from "./sampleFlow.sampleTableHelpers";
import { buildSampleTaskFlow } from "./sampleFlow.taskFlow";
import { getSampleTrayForCode } from "./sampleFlow.trayScope";
import { buildSamplesFlowView, buildTrayFlowView } from "./samplesFlowModel";
import { normalizeText } from "./sampleFlow.shared";

const props = defineProps({
  active: { type: Boolean, default: false },
  staging: { type: Boolean, default: false },
  samplesFlow: { type: Object, required: true },
});

const view = computed(() => {
  const data = props.samplesFlow;
  if (props.staging) {
    return {
      prefix: "samples-staging",
      title: "暂存间样品",
      rows: data.stagingRows,
      query: data.stagingQuery,
      task: data.stagingSelectedTaskCode,
      status: data.stagingSelectedStatus,
      tasks: data.stagingTaskOptions,
      statuses: data.stagingStatusOptions,
      setQuery: data.setStagingQuery,
      setTask: data.setStagingTaskFilter,
      setStatus: data.setStagingStatusFilter,
    };
  }
  return {
    prefix: "samples-flow",
    title: "样品流转与状态",
    rows: data.sampleRows,
    query: data.query,
    task: data.selectedTaskCode,
    status: data.selectedStatus,
    tasks: data.taskOptions,
    statuses: data.statusOptions,
    setQuery: data.setQuery,
    setTask: data.setTaskFilter,
    setStatus: data.setStatusFilter,
  };
});

const groups = computed(() => {
  const buckets = new Map();
  for (const sample of view.value.rows) {
    const taskCode = normalizeText(sample.task_code);
    const trayCodes = sample.trayCodes.length ? sample.trayCodes : [""];
    for (const trayCode of trayCodes) {
      const key = JSON.stringify([taskCode, trayCode]);
      if (!buckets.has(key)) {
        buckets.set(key, { key, taskCode, trayCode, samples: [] });
      }
      buckets.get(key).samples.push(sample);
    }
  }
  return Array.from(buckets.values()).sort((left, right) =>
    Number(Boolean(right.trayCode)) - Number(Boolean(left.trayCode))
    || left.trayCode.localeCompare(right.trayCode, "zh-Hans-CN")
    || left.taskCode.localeCompare(right.taskCode, "zh-Hans-CN"),
  );
});

const linkedGroupCount = computed(() => groups.value.filter((group) => group.trayCode).length);
const taskGroups = computed(() => {
  const tasks = new Map();
  for (const group of groups.value) {
    if (!tasks.has(group.taskCode)) tasks.set(group.taskCode, []);
    tasks.get(group.taskCode).push(group);
  }
  // A search can leave just one visible branch of a multi-tray task.
  const fullTaskGroups = new Map();
  if (props.samplesFlow.fullSamplesLoaded && (view.value.query || view.value.task || view.value.status)) {
    for (const sample of props.samplesFlow.rawSamples) {
      const code = normalizeText(sample.task_code);
      if (!tasks.has(code)) continue;
      if (props.staging && ![DEFAULT_LABELS.preRetentionLocation, DEFAULT_LABELS.postRetentionLocation].includes(normalizeText(sample.location))) continue;
      const trayCodes = resolveSampleTableTrayCodes(sample);
      const branches = fullTaskGroups.get(code) || new Set();
      for (const trayCode of trayCodes.length ? trayCodes : [""]) branches.add(trayCode);
      fullTaskGroups.set(code, branches);
    }
  }
  return Array.from(tasks, ([code, children]) => {
    const trayCount = children.filter((group) => group.trayCode).length;
    const totalBranches = Math.max(children.length, fullTaskGroups.get(code)?.size || 0);
    return {
      code,
      groups: children,
      trayCount,
      expandable: totalBranches > 1,
      isPartial: totalBranches > children.length,
      hasUnassigned: trayCount < children.length,
      sampleCount: new Set(children.flatMap((group) => group.samples.map((sample) => sample.id || sample.code))).size,
    };
  });
});
const trayCapacityText = computed(() =>
  `${getRemainingSystemTrayCount(props.samplesFlow.trayRows.length)} / ${SYSTEM_TRAY_TOTAL}`,
);
const taskTotals = computed(() => {
  const tasks = new Set();
  const assignedTasks = new Set();
  for (const { taskCode, trayCode } of groups.value) {
    if (!taskCode) continue;
    tasks.add(taskCode);
    if (trayCode) assignedTasks.add(taskCode);
  }
  return { total: tasks.size, assigned: assignedTasks.size };
});
const requestedGroup = ref("");
const collapsedTaskCode = ref(null);
const trayScroll = ref(null);
const sampleScroll = ref(null);
const flowWarning = ref("");
const flowDialogKey = ref("");
const showAllTraySamples = ref(false);
const selectedGroup = computed(() => {
  const selected = groups.value.find((group) => group.key === requestedGroup.value);
  if (selected) return selected;
  const query = normalizeText(view.value.query).toLowerCase();
  const match = query && (
    groups.value.find((group) => group.trayCode.toLowerCase() === query)
    || groups.value.find((group) => group.samples.some((sample) => normalizeText(sample.code).toLowerCase() === query))
    || groups.value.find((group) => group.trayCode.toLowerCase().includes(query) && !group.taskCode.toLowerCase().includes(query))
  );
  return match || groups.value[0] || null;
});
const isTaskExpanded = (task) => task.expandable
  && selectedGroup.value?.taskCode === task.code
  && collapsedTaskCode.value !== task.code;
const selectGroup = (group) => {
  requestedGroup.value = group.key;
  collapsedTaskCode.value = null;
};
const toggleTask = (task) => {
  if (isTaskExpanded(task)) {
    collapsedTaskCode.value = task.code;
    return;
  }
  selectGroup(selectedGroup.value?.taskCode === task.code ? selectedGroup.value : task.groups[0]);
};
const openTrayFlow = (group) => {
  selectGroup(group);
  flowDialogKey.value = group.key;
};
const clearWarning = () => {
  flowWarning.value = "";
  props.samplesFlow.clearWarning();
};

watch([() => view.value.query, () => view.value.task, () => view.value.status], () => {
  if (trayScroll.value) trayScroll.value.scrollTop = 0;
  requestedGroup.value = "";
  collapsedTaskCode.value = null;
  showAllTraySamples.value = false;
});
watch(() => selectedGroup.value?.key, () => {
  showAllTraySamples.value = false;
  if (flowDialogKey.value !== selectedGroup.value?.key) flowDialogKey.value = "";
  if (sampleScroll.value) sampleScroll.value.scrollTop = 0;
});
watch(showAllTraySamples, () => {
  if (sampleScroll.value) sampleScroll.value.scrollTop = 0;
});
watch(() => props.active, (active) => {
  if (!active) flowDialogKey.value = "";
});
watch([() => props.active, () => selectedGroup.value?.taskCode], async ([active, taskCode]) => {
  if (!active || !taskCode) return;
  flowWarning.value = "";
  try {
    await props.samplesFlow.ensureFullSamples();
  } catch {
    flowWarning.value = "流程记录加载失败，请稍后重试";
  }
}, { immediate: true });

const selectedTaskFlow = computed(() => buildSampleTaskFlow({
  taskCode: selectedGroup.value?.taskCode,
  tasks: props.samplesFlow.rawTasks,
  samples: props.samplesFlow.rawSamples,
  experiments: props.samplesFlow.rawExperiments,
}));

const selectedTrayBindings = computed(() => {
  const group = selectedGroup.value;
  if (!group?.trayCode) return [];
  return props.samplesFlow.rawSamples
    .filter((sample) => normalizeText(sample.task_code) === group.taskCode)
    .flatMap((sample) => {
      const binding = getSampleTrayForCode(sample, group.trayCode);
      return binding ? [{ sample, binding }] : [];
    });
});
const fullTraySamples = computed(() => {
  const matches = selectedGroup.value?.samples || [];
  if (!props.samplesFlow.fullSamplesLoaded || !selectedGroup.value?.trayCode) return matches;
  const samples = new Map(matches.map((sample) => [normalizeText(sample.code), sample]));
  const traySamples = selectedTrayBindings.value.map(({ sample }) => sample);
  const { rows } = buildSamplesFlowView({ samples: traySamples, pageSize: Math.max(1, traySamples.length) });
  for (const sample of rows) samples.set(normalizeText(sample.code), sample);
  return [...samples.values()].sort((left, right) => left.code.localeCompare(right.code, "zh-Hans-CN", { numeric: true }));
});
const hasAdditionalTraySamples = computed(() => Boolean(
  selectedGroup.value?.trayCode && fullTraySamples.value.length > selectedGroup.value.samples.length,
));
const visibleSamples = computed(() => showAllTraySamples.value && hasAdditionalTraySamples.value
  ? fullTraySamples.value
  : selectedGroup.value?.samples || []);

const selectedTrayFlow = computed(() => {
  const group = selectedGroup.value;
  if (!group?.trayCode) return null;
  const data = props.samplesFlow;
  const tray = data.trayRows.find((row) => row.taskCode === group.taskCode && row.trayCode === group.trayCode);
  const firstBinding = selectedTrayBindings.value[0];
  const status = tray?.status || firstBinding?.binding.status || group.samples[0]?.status;
  return buildTrayFlowView({
    experimentRunPauses: data.rawExperimentRunPauses,
    experimentRuns: data.rawExperimentRuns,
    experimentRunSteps: data.rawExperimentRunSteps,
    experimentRunTrays: data.rawExperimentRunTrays,
    experimentTrays: data.rawExperimentTrays,
    experiments: data.rawExperiments,
    location: status === "已到达暂存间" ? DEFAULT_LABELS.preRetentionLocation : firstBinding?.sample.location || group.samples[0]?.location,
    samples: data.rawSamples,
    schedules: data.rawSchedules,
    stagingEvents: data.rawStagingEvents,
    taskCode: group.taskCode,
    trayCode: group.trayCode,
    status,
  });
});

</script>
