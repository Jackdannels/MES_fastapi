import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { startServerClockSync, syncServerClock } from "./lib/serverClock";
import "./assets/app.css";

window.__MES_VUE_BOOT__ = true;

const app = createApp(App);
app.use(router);

void syncServerClock()
  .catch(() => {})
  .finally(() => {
    startServerClockSync();
    app.mount("#app");
  });
