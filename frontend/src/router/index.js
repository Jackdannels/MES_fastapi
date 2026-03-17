import { createRouter, createWebHistory } from "vue-router";
import { fetchAuthSession } from "@/auth";
import { buildRouteAccessDecision } from "@/lib/authRouting";
import { buildDocumentTitle } from "@/lib/routerTitle";
import { routes } from "@/modules";

const router = createRouter({
  history: createWebHistory("/"),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  return buildRouteAccessDecision({
    getSession: fetchAuthSession,
    to,
  });
});

router.afterEach((to) => {
  document.title = buildDocumentTitle(to.meta?.title);
});

export default router;
