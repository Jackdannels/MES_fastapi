import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "./assets/app.css";

window.__MES_VUE_BOOT__ = true;

const app = createApp(App);
app.use(router);
app.mount("#app");
