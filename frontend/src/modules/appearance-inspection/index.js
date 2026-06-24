import page from "@/modules/staging-management/page.vue";

export default {
  nav: true,
  route: {
    path: "/appearance-inspection",
    name: "appearance-inspection",
    component: page,
    meta: {
      module: "appearance",
      storageRoom: "appearance",
      title: "外观检测间系统",
      subtitle: "盐雾、霉菌、高低温湿热样品外观检测入库与出库管理",
    },
  },
};
