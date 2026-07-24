import { useDevicesPageEngine } from "./useDevicesPageEngine";

// 设备页公共兼容门面：保留原调用方式、返回字段和响应式对象身份。
function useDevicesPage() {
  return useDevicesPageEngine();
}

export { useDevicesPage };
