import { h, onBeforeUnmount, onMounted, ref } from "vue";
import { formatLocalDateTime } from "@/lib/dateTime";

// Keep the one-second update inside the clock, not the sample-heavy board.
export const LiveClock = {
  name: "LiveClock",
  setup() {
    const currentTime = ref(formatLocalDateTime());
    const refresh = () => { currentTime.value = formatLocalDateTime(); };
    let timer = null;

    onMounted(() => {
      refresh();
      timer = window.setInterval(refresh, 1000);
      document.addEventListener("visibilitychange", refresh);
    });
    onBeforeUnmount(() => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    });

    return () => h("time", {
      class: "visual-board-time",
      datetime: `${currentTime.value.replace(" ", "T")}+08:00`,
      title: "北京时间",
    }, currentTime.value);
  },
};
