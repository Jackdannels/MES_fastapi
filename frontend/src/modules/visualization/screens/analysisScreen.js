import { h, ref } from "vue";

const ANALYSIS_PRODUCT_COUNTS = {
  "振动一室": 72,
  "高低温湿热一室": 46,
  "高低温湿热二室": 38,
  "盐雾试验室": 58,
  "冲击一室": 34,
  "霉菌试验室": 63,
  "四综合实验室": 41,
  "冲击二室": 29,
  "温度冲击二室": 36,
  "温度冲击一室": 31,
  "振动二室": 39,
};
const ANALYSIS_COLORS = ["#2563eb", "#f97316", "#16a34a", "#ef4444", "#a855f7", "#eab308", "#0891b2", "#db2777", "#65a30d", "#dc2626"];
const analysisStatusRows = [
  { color: "#2dd4bf", count: 86, label: "正常", percent: 78.2 },
  { color: "#ef4444", count: 15, label: "维修", percent: 13.6 },
  { color: "#ef4444", count: 9, label: "停用", percent: 8.2 },
  { color: "#64748b", count: 46, label: "占用", percent: 42 },
];
const analysisTimePresets = ["今日", "本周", "本月", "年初至今", "自定义"];
const analysisTimeConfigs = {
  今日: { label: "今日", granularity: "按小时", range: "今日 · 2026-05-28", scale: 0.12 },
  本周: { label: "本周", granularity: "按日", range: "本周 · 2026-05-25 至 2026-05-28", scale: 0.36 },
  本月: { label: "本月", granularity: "按日/周", range: "本月 · 2026-05-01 至 2026-05-28", scale: 0.68 },
  年初至今: { label: "年初至今", granularity: "按月", range: "年初至今 · 2026-01-01 至 2026-05-28", scale: 1 },
};
const analysisCustomModes = [
  { control: "date", granularity: "按小时", key: "day", label: "按天", range: "自定义 · 按天 · 2026-05-28", scale: 0.12, value: "2026-05-28" },
  { control: "month", granularity: "按日/周", key: "month", label: "按月", range: "自定义 · 按月 · 2026-05", scale: 0.68, value: "2026-05" },
  { control: "number", granularity: "按月", key: "year", label: "按年", range: "自定义 · 按年 · 2026", scale: 1, value: "2026" },
  { control: "range", granularity: "按日", key: "range", label: "时间段", range: "自定义 · 时间段 · 2026-05-01 至 2026-05-28", scale: 0.48, value: "2026-05-01" },
];
const padCalendarPart = (value) => String(value).padStart(2, "0");
const parseCalendarDate = (value, fallback = "2026-05-28") => {
  const [fallbackYear, fallbackMonth, fallbackDay] = fallback.split("-");
  const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return {
    day: matched?.[3] || fallbackDay,
    month: matched?.[2] || fallbackMonth,
    year: matched?.[1] || fallbackYear,
  };
};
const getCalendarMonthDayCount = (year, month) => new Date(Number(year), Number(month), 0).getDate();
const buildAnalysisCalendarDayOptions = (year, month) =>
  Array.from({ length: getCalendarMonthDayCount(year, month) }, (_, index) => {
    const day = padCalendarPart(index + 1);
    return { label: `${index + 1}日`, value: day };
  });
const clampCalendarDay = (year, month, day) => padCalendarPart(Math.min(Math.max(Number(day) || 1, 1), getCalendarMonthDayCount(year, month)));
const analysisCalendarMonths = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, "0");
  return { label: `${index + 1}月`, value: `2026-${month}` };
});
const analysisCalendarMonthOptions = Array.from({ length: 12 }, (_, index) => {
  const month = padCalendarPart(index + 1);
  return { label: `${index + 1}月`, value: month };
});
const analysisCalendarYears = Array.from({ length: 10 }, (_, index) => 2021 + index);
const ANALYSIS_CALENDAR_WHEEL_STEP_DELTA = 240;

const polarPoint = (centerX, centerY, radius, angle) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: centerX + Math.cos(radians) * radius,
    y: centerY + Math.sin(radians) * radius,
  };
};

const describePieSlice = (centerX, centerY, radius, startAngle, endAngle) => {
  const start = polarPoint(centerX, centerY, radius, startAngle);
  const end = polarPoint(centerX, centerY, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    "Z",
  ].join(" ");
};

const buildAnalysisLabRows = (labNames, scale = 1) => {
  const names = (Array.isArray(labNames) ? labNames : []).filter(Boolean);
  return names.map((name, index) => ({
    color: ANALYSIS_COLORS[index % ANALYSIS_COLORS.length],
    name,
    value: Math.max(1, Math.round((ANALYSIS_PRODUCT_COUNTS[name] || Math.max(18, 42 - index * 2)) * scale)),
  }));
};

const buildPieSegments = (rows) => {
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  let cursor = 0;
  return rows.map((row) => {
    const startAngle = cursor;
    const endAngle = cursor + (row.value / total) * 360;
    cursor = endAngle;
    const midAngle = (startAngle + endAngle) / 2;
    const guideStart = polarPoint(380, 278, 172, midAngle);
    const guideEnd = polarPoint(380, 278, 246, midAngle);
    const textX = Math.max(42, Math.min(718, guideEnd.x));
    const textY = Math.max(34, Math.min(522, guideEnd.y));
    return {
      ...row,
      anchor: textX < 380 ? "end" : "start",
      guide: `M ${guideStart.x.toFixed(1)} ${guideStart.y.toFixed(1)} L ${textX.toFixed(1)} ${textY.toFixed(1)}`,
      path: describePieSlice(380, 278, 158, startAngle, endAngle),
      textX,
      textY,
    };
  });
};

export const AnalysisScreen = {
  name: "AnalysisScreen",
  props: {
    compact: { type: Boolean, default: false },
    devices: { type: Array, required: false, default: () => [] },
    interactive: { type: Boolean, default: false },
    labNames: { type: Array, required: false, default: () => [] },
    screen: { type: Object, required: false, default: null },
  },
  setup(props) {
    const customMenuOpen = ref(false);
    const activePicker = ref("day");
    const activeRangeSide = ref("start");
    const calendarCursor = ref({ day: "28", month: "05", year: "2026" });
    const customValues = ref({
      day: "2026-05-28",
      month: "2026-05",
      rangeEnd: "2026-05-28",
      rangeStart: "2026-05-01",
      year: "2026",
    });
    const calendarWheelDelta = ref({ day: 0, month: 0, year: 0 });
    const selectedCustomMode = ref(null);
    const selectedTimePreset = ref("年初至今");
    const syncCalendarCursor = (value) => {
      const parsed = parseCalendarDate(value, customValues.value.day);
      calendarCursor.value = {
        month: parsed.month,
        day: parsed.day,
        year: parsed.year,
      };
    };
    const getCalendarCursorDate = (cursor = calendarCursor.value) =>
      `${cursor.year}-${cursor.month}-${clampCalendarDay(cursor.year, cursor.month, cursor.day)}`;
    const commitCalendarCursorDate = (cursor = calendarCursor.value) => {
      const value = getCalendarCursorDate(cursor);
      if (activePicker.value === "range") {
        customValues.value[activeRangeSide.value === "end" ? "rangeEnd" : "rangeStart"] = value;
        selectedCustomMode.value = resolveCustomMode("range");
        return;
      }
      if (activePicker.value === "day") {
        customValues.value.day = value;
        selectedCustomMode.value = resolveCustomMode("day");
      }
    };
    const updateCalendarCursor = (partial, shouldCommit = true) => {
      const nextCursor = {
        ...calendarCursor.value,
        ...partial,
      };
      nextCursor.day = clampCalendarDay(nextCursor.year, nextCursor.month, nextCursor.day);
      calendarCursor.value = nextCursor;
      if (shouldCommit) {
        commitCalendarCursorDate(nextCursor);
      }
    };
    const resolveCustomMode = (modeOrKey) => {
      const key = typeof modeOrKey === "string" ? modeOrKey : modeOrKey?.key;
      const baseMode = analysisCustomModes.find((mode) => mode.key === key) || analysisCustomModes[0];
      const values = customValues.value;
      if (baseMode.key === "range") {
        return {
          ...baseMode,
          range: `自定义 · 时间段 · ${values.rangeStart} 至 ${values.rangeEnd}`,
          value: values.rangeStart,
        };
      }
      if (baseMode.key === "day") {
        return { ...baseMode, range: `自定义 · 按天 · ${values.day}`, value: values.day };
      }
      if (baseMode.key === "month") {
        return { ...baseMode, range: `自定义 · 按月 · ${values.month}`, value: values.month };
      }
      return { ...baseMode, range: `自定义 · 按年 · ${values.year}`, value: values.year };
    };
    const selectPreset = (preset) => {
      if (preset === "自定义") {
        selectedTimePreset.value = "自定义";
        customMenuOpen.value = true;
        activePicker.value = selectedCustomMode.value?.key || "day";
        return;
      }
      selectedTimePreset.value = preset;
      selectedCustomMode.value = null;
      customMenuOpen.value = false;
    };
    const selectCustomMode = (modeOrKey) => {
      const mode = resolveCustomMode(modeOrKey);
      selectedTimePreset.value = "自定义";
      selectedCustomMode.value = mode;
      activePicker.value = mode.key;
    };
    const openCustomPicker = (mode, rangeSide = "start") => {
      if (mode.key === "range") {
        activeRangeSide.value = rangeSide;
        syncCalendarCursor(customValues.value[rangeSide === "end" ? "rangeEnd" : "rangeStart"]);
      }
      if (mode.key === "day") {
        syncCalendarCursor(customValues.value.day);
      }
      selectCustomMode(mode);
    };
    const chooseCalendarYear = (year) => {
      updateCalendarCursor({ year: String(year) });
    };
    const chooseCalendarMonth = (month) => {
      updateCalendarCursor({ month });
    };
    const chooseCalendarDay = (day) => {
      updateCalendarCursor({ day });
    };
    const stepCalendarYear = (direction) => {
      const years = analysisCalendarYears.map(String);
      const currentIndex = years.indexOf(calendarCursor.value.year);
      const nextIndex = Math.min(Math.max((currentIndex >= 0 ? currentIndex : 0) + direction, 0), years.length - 1);
      chooseCalendarYear(years[nextIndex]);
    };
    const stepCalendarMonth = (direction) => {
      const currentMonth = Number(calendarCursor.value.month) || 1;
      const nextMonth = Math.min(Math.max(currentMonth + direction, 1), 12);
      chooseCalendarMonth(padCalendarPart(nextMonth));
    };
    const stepCalendarDay = (direction) => {
      const currentDay = Number(calendarCursor.value.day) || 1;
      const nextDay = Math.min(Math.max(currentDay + direction, 1), getCalendarMonthDayCount(calendarCursor.value.year, calendarCursor.value.month));
      chooseCalendarDay(padCalendarPart(nextDay));
    };
    const handleCalendarWheel = (type, event) => {
      event.preventDefault();
      event.stopPropagation();
      const deltaY = Number(event.deltaY) || 0;
      if (deltaY === 0) {
        return;
      }
      const currentDelta = calendarWheelDelta.value[type] || 0;
      const nextDelta = currentDelta && Math.sign(currentDelta) !== Math.sign(deltaY) ? deltaY : currentDelta + deltaY;
      if (Math.abs(nextDelta) < ANALYSIS_CALENDAR_WHEEL_STEP_DELTA) {
        calendarWheelDelta.value = { ...calendarWheelDelta.value, [type]: nextDelta };
        return;
      }
      const direction = nextDelta >= 0 ? 1 : -1;
      const remainingDelta = nextDelta - direction * ANALYSIS_CALENDAR_WHEEL_STEP_DELTA;
      calendarWheelDelta.value = {
        ...calendarWheelDelta.value,
        [type]: Math.sign(remainingDelta) === direction ? remainingDelta : 0,
      };
      if (type === "year") {
        stepCalendarYear(direction);
        return;
      }
      if (type === "month") {
        stepCalendarMonth(direction);
        return;
      }
      stepCalendarDay(direction);
    };
    const stepCalendarByType = (type, direction) => {
      calendarWheelDelta.value = { ...calendarWheelDelta.value, [type]: 0 };
      if (type === "year") {
        stepCalendarYear(direction);
        return;
      }
      if (type === "month") {
        stepCalendarMonth(direction);
        return;
      }
      stepCalendarDay(direction);
    };
    const chooseMonth = (value) => {
      customValues.value.month = value;
      selectCustomMode("month");
    };
    const chooseYear = (value) => {
      customValues.value.year = String(value);
      selectCustomMode("year");
    };
    const toggleCustomMenu = () => {
      if (!props.compact) {
        selectedTimePreset.value = "自定义";
        activePicker.value = selectedCustomMode.value?.key || "day";
        customMenuOpen.value = !customMenuOpen.value;
      }
    };
    const closeCustomMenu = () => {
      customMenuOpen.value = false;
    };
    const renderCalendarWheel = (label, testId, options, activeValue, onSelect, wheelType) =>
      {
        const activeIndex = Math.max(options.findIndex((option) => option.value === activeValue), 0);
        return h("div", { class: "visual-analysis-calendar-wheel", "data-testid": testId, onWheel: (event) => handleCalendarWheel(wheelType, event) }, [
          h("span", label),
          h(
            "button",
            {
              "aria-label": `${label}上一项`,
              class: "visual-analysis-calendar-arrow is-up",
              disabled: activeIndex === 0,
              "data-testid": `visual-analysis-calendar-${wheelType}-up`,
              type: "button",
              onClick: () => stepCalendarByType(wheelType, -1),
            },
            "▲",
          ),
          h("div", { class: "visual-analysis-calendar-wheel-options", onWheel: (event) => handleCalendarWheel(wheelType, event) }, [
            h("div", { class: "visual-analysis-calendar-wheel-track", style: { "--visual-wheel-index": activeIndex } }, options.map((option) =>
              h(
                "button",
                {
                  class: activeValue === option.value ? "is-active" : "",
                  "data-testid": `visual-analysis-calendar-${wheelType}-${option.value}`,
                  key: option.value,
                  type: "button",
                  onClick: () => onSelect(option.value),
                },
                option.label,
              ),
            )),
          ]),
          h(
            "button",
            {
              "aria-label": `${label}下一项`,
              class: "visual-analysis-calendar-arrow is-down",
              disabled: activeIndex >= options.length - 1,
              "data-testid": `visual-analysis-calendar-${wheelType}-down`,
              type: "button",
              onClick: () => stepCalendarByType(wheelType, 1),
            },
            "▼",
          ),
        ]);
      };
    const renderCalendarDateWheelPicker = () =>
      h("div", { class: "visual-analysis-calendar-wheel-panel", "data-testid": "visual-analysis-calendar-date-wheel" }, [
        renderCalendarWheel(
          "年份",
          "visual-analysis-calendar-year-wheel",
          analysisCalendarYears.map((year) => ({ label: String(year), value: String(year) })),
          calendarCursor.value.year,
          chooseCalendarYear,
          "year",
        ),
        renderCalendarWheel(
          "月份",
          "visual-analysis-calendar-month-wheel",
          analysisCalendarMonthOptions,
          calendarCursor.value.month,
          chooseCalendarMonth,
          "month",
        ),
        renderCalendarWheel(
          "日期",
          "visual-analysis-calendar-day-wheel",
          buildAnalysisCalendarDayOptions(calendarCursor.value.year, calendarCursor.value.month),
          calendarCursor.value.day,
          chooseCalendarDay,
          "day",
        ),
      ]);
    const renderDateField = (mode) => {
      if (mode.key === "range") {
        const renderRangeButton = (side, label) =>
          h(
            "button",
            {
              class: ["visual-analysis-date-field", activeRangeSide.value === side ? "is-active" : ""],
              "data-testid": "visual-analysis-calendar-range",
              type: "button",
              onClick: (event) => {
                event.stopPropagation();
                openCustomPicker(mode, side);
              },
            },
            label,
          );
        return h("span", { class: "visual-analysis-range" }, [
          renderRangeButton("start", customValues.value.rangeStart),
          renderRangeButton("end", customValues.value.rangeEnd),
        ]);
      }
      const fieldValue = mode.key === "day" ? customValues.value.day : mode.key === "month" ? customValues.value.month : customValues.value.year;
      return h(
        "button",
        {
          class: "visual-analysis-date-field",
          "data-testid": `visual-analysis-calendar-${mode.key}`,
          type: "button",
          onClick: (event) => {
            event.stopPropagation();
            openCustomPicker(mode);
          },
        },
        fieldValue,
      );
    };
    const renderPickerPanel = () => {
      if (activePicker.value === "month") {
        return h("div", { class: "visual-analysis-picker-panel", "data-testid": "visual-analysis-month-grid" }, analysisCalendarMonths.map((month) =>
          h(
            "button",
            {
              class: customValues.value.month === month.value ? "is-active" : "",
              key: month.value,
              type: "button",
              onClick: () => chooseMonth(month.value),
            },
            month.label,
          ),
        ));
      }
      if (activePicker.value === "year") {
        return h("div", { class: "visual-analysis-picker-panel visual-analysis-year-grid", "data-testid": "visual-analysis-year-grid" }, analysisCalendarYears.map((year) =>
          h("button", { class: customValues.value.year === String(year) ? "is-active" : "", key: year, type: "button", onClick: () => chooseYear(year) }, String(year)),
        ));
      }
      if (activePicker.value === "range") {
        const rangeMode = analysisCustomModes.find((mode) => mode.key === "range");
        return h("div", { class: "visual-analysis-picker-panel is-range", "data-testid": "visual-analysis-range-grid" }, [
          h("div", { class: "visual-analysis-range-pick-head" }, [
            h("span", "选择起止日期"),
            renderDateField(rangeMode),
          ]),
          renderCalendarDateWheelPicker(),
        ]);
      }
      return h("div", { class: "visual-analysis-picker-panel is-calendar", "data-testid": "visual-analysis-day-picker" }, [
        renderCalendarDateWheelPicker(),
      ]);
    };

    return () => {
      const activeConfig =
        selectedTimePreset.value === "自定义"
          ? selectedCustomMode.value || analysisCustomModes[0]
          : analysisTimeConfigs[selectedTimePreset.value] || analysisTimeConfigs["年初至今"];
      const rows = buildAnalysisLabRows(props.labNames, activeConfig.scale);
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      const pieSegments = buildPieSegments(rows);
      const topRows = rows.slice().sort((left, right) => right.value - left.value);
      const visibleRows = props.compact ? topRows.slice(0, 5) : topRows;
      const deviceRows = Array.isArray(props.devices) ? props.devices : [];
      const abnormalCount = deviceRows.filter((device) => {
        const status = String(device?.status || "").trim();
        return status.includes("维修")
          || status.includes("保养")
          || status.includes("停用")
          || status.includes("禁用")
          || status.includes("故障");
      }).length;
      const normalCount = Math.max(0, deviceRows.length - abnormalCount);
      const normalRate = deviceRows.length ? `${((normalCount / deviceRows.length) * 100).toFixed(1)}%` : "0.0%";

      return h("div", { class: ["visual-board", "visual-analysis-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top visual-analysis-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "EQUIPMENT / PRODUCT"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "设备状态与产品统计屏"),
          ]),
          h("div", { class: "visual-analysis-filterbar" }, [
            h("select", { class: "visual-analysis-select", "aria-label": "试验间筛选" }, [
              h("option", "综合"),
              ...rows.map((row) => h("option", { key: row.name }, row.name)),
            ]),
            h("div", { class: "visual-analysis-time-card" }, [
              h("span", `统计时间 · 自动粒度：${activeConfig.granularity}`),
              h("strong", activeConfig.range),
            ]),
            h("div", { class: "visual-analysis-filter-row", "data-testid": "visual-analysis-filter-row" }, analysisTimePresets.map((preset) => {
              if (preset === "自定义" && !props.compact) {
                return h("div", { class: ["visual-analysis-custom", customMenuOpen.value ? "is-open" : ""], key: preset }, [
                  h(
                    "button",
                    {
                      class: ["visual-analysis-time-chip", selectedTimePreset.value === "自定义" ? "is-active" : ""],
                      "aria-expanded": String(customMenuOpen.value),
                      "aria-haspopup": "menu",
                      "data-testid": "visual-analysis-custom-trigger",
                      type: "button",
                      onClick: (event) => {
                        event.stopPropagation();
                        toggleCustomMenu();
                      },
                    },
                    preset,
                  ),
                  customMenuOpen.value
                    ? h("div", { class: "visual-analysis-custom-menu", "data-testid": "visual-analysis-custom-menu", role: "menu" }, [
                      ...analysisCustomModes.map((mode) =>
                        h("div", {
                          class: ["visual-analysis-custom-row", (selectedCustomMode.value?.key || activePicker.value) === mode.key ? "is-active" : ""],
                          "data-testid": "visual-analysis-custom-mode",
                          key: mode.label,
                          role: "menuitem",
                          tabindex: 0,
                          onClick: () => openCustomPicker(mode),
                          onKeydown: (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openCustomPicker(mode);
                            }
                          },
                        }, [
                          h("strong", mode.label),
                          renderDateField(mode),
                        ]),
                      ),
                      renderPickerPanel(),
                      h("button", { class: "visual-analysis-menu-close", type: "button", onClick: closeCustomMenu }, "确认"),
                    ])
                    : null,
                ]);
              }
              return props.compact
                ? h("span", { class: ["visual-analysis-time-chip", selectedTimePreset.value === preset ? "is-active" : ""], key: preset }, preset)
                : h("button", { class: ["visual-analysis-time-chip", selectedTimePreset.value === preset ? "is-active" : ""], key: preset, type: "button", onClick: () => selectPreset(preset) }, preset);
            })),
          ]),
        ]),
        h("div", { class: "visual-analysis-layout" }, [
          h("section", { class: "visual-analysis-panel visual-analysis-health" }, [
            h("div", { class: "visual-analysis-panel-head" }, [
              h("strong", "年度设备健康状态"),
              h("span", "综合 · 2026年截至05-28 · 当前快照"),
            ]),
            h("div", { class: "visual-analysis-health-metrics" }, [
              h("div", [h("span", "设备总数"), h("strong", String(deviceRows.length))]),
              h("div", [h("span", "正常率"), h("strong", normalRate)]),
              h("div", [h("span", "异常设备"), h("strong", String(abnormalCount))]),
            ]),
            h("div", { class: "visual-analysis-health-body" }, [
              h("div", { class: "visual-analysis-health-ring" }, [
                h("span", "综合状态"),
                h("strong", normalRate),
              ]),
              h("div", { class: "visual-analysis-status-list" }, analysisStatusRows.map((row) =>
                h("div", { class: "visual-analysis-status-row", key: row.label, style: { "--visual-status-color": row.color } }, [
                  h("span", row.label),
                  h("div", [h("i", { style: { width: `${row.percent}%` } })]),
                  h("b", row.count),
                ]),
              )),
            ]),
            h("div", { class: "visual-analysis-trend" }, [
              h("div", [h("span", "近 6 个月正常率"), h("b", "按月快照")]),
              h("div", { class: "visual-analysis-trend-bars" }, [62, 54, 68, 59, 73, 66].map((height, index) =>
                h("span", { key: index, style: { "--visual-trend-height": `${height}%` } }),
              )),
            ]),
          ]),
          h("section", { class: "visual-analysis-panel visual-analysis-product-panel" }, [
            h("div", { class: "visual-analysis-panel-head" }, [
              h("strong", "试验间实验产品数分布"),
              h("span", `${activeConfig.label || "自定义"} · 全部试验间 · 模拟临时数据`),
            ]),
            h("div", { class: "visual-analysis-product-main" }, [
              h("svg", { class: "visual-analysis-pie", role: "img", viewBox: "0 0 760 560", "aria-label": "全部试验间实验产品数饼图" }, [
                h("g", pieSegments.map((segment) => h("path", { class: "visual-analysis-pie-slice", d: segment.path, fill: segment.color, key: `${segment.name}-path` }))),
                h("circle", { cx: "380", cy: "278", fill: "#05070a", r: "62", stroke: "rgba(238,253,249,.14)", "stroke-width": "18" }),
                h("text", { class: "visual-analysis-pie-total", "dominant-baseline": "central", "text-anchor": "middle", x: "380", y: "278" }, total),
                h("g", pieSegments.map((segment) => h("path", { class: "visual-analysis-pie-guide", d: segment.guide, key: `${segment.name}-guide` }))),
                h("g", { class: "visual-analysis-pie-labels" }, pieSegments.map((segment) =>
                  h("text", { key: `${segment.name}-label`, "text-anchor": segment.anchor, x: segment.textX.toFixed(0), y: segment.textY.toFixed(0) }, `${segment.name} ${segment.value}`),
                )),
              ]),
              h("div", { class: "visual-analysis-ranking" }, [
                h("div", { class: "visual-analysis-total" }, [h("span", "当前筛选范围产品总数"), h("strong", total)]),
                ...visibleRows.map((row) =>
                  h("div", { class: "visual-analysis-rank-row", key: row.name, style: { "--visual-rank-color": row.color } }, [
                    h("i"),
                    h("span", row.name),
                    h("strong", row.value),
                    h("b", `${((row.value / total) * 100).toFixed(1)}%`),
                  ]),
                ),
              ]),
            ]),
          ]),
          h("section", { class: "visual-analysis-panel visual-analysis-rules" }, [
            h("div", [h("strong", "快捷筛选"), h("span", "今日按小时；本周按日；本月按日/周；年初至今按月。")]),
            h("div", [h("strong", "自定义菜单"), h("span", "按天、按月、按年、时间段集中在同一按钮下弹出选择。")]),
            h("div", [h("strong", "数据口径"), h("span", "产品数暂用临时模拟数据，后续接入 schedule.device + samples 去重统计。")]),
            h("div", [h("strong", "完整显示"), h("span", "饼图与排行同步列出全部试验间名称和数量。")]),
          ]),
        ]),
      ]);
    };
  },
};

