# 综合测试终端缩放功能验收

日期：2026-11-13。

## 已实现

- 全部 16 个业务页面共用本机页面缩放；页头在刷新左侧显示 `缩放 − 比例 + | 重置`。
- Ctrl + 滚轮、Ctrl + 加减号、加减按钮按同一档位调整。普通滚轮正常滚动，Ctrl + 0 与重置按钮恢复 100%。
- 档位 50%、67%、75%、80%、90%、100%、110%、125%、150%、175%、200%。原生宿主处理每次请求并发布真实 WebView2 ZoomFactor，前端等到实际状态后更新读数。
- 页面刷新、同一终端切换业务页面、重新连接和关闭重开后沿用同一偏好。偏好原子写入本机 DataDirectory 下的 `page-zoom.json`；无效偏好恢复 100%。
- 浏览器默认缩放关闭，由宿主在文档创建时安装的手势监听器统一处理输入，避免 Ctrl + 滚轮产生两次缩放。没有添加 CSS zoom 或 transform 缩放。
- 接驳区独立页头、共享页头、深浅主题及高倍缩放下的换行均已接入。

## 验证证据

### 前端

9 个直接相关测试文件，236 项通过：

```powershell
rtk npm run test:run -- src/lib/desktopZoom.test.js src/components/shared/DesktopZoomControls.test.js src/lib/desktopClient.test.js src/lib/testClientNavigation.test.js src/App.runtime.test.js src/modules/handover-system/page.runtime.test.js src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/assets/appStyles.test.js src/shared/styles/components.test.js
```

前端 lint 与 Vite 生产构建通过。

### 编译后的 Windows 客户端

`tests/core/test_desktop_client.py`：21 项通过。

`tests/core/test_desktop_test_terminal.py`：4 项通过（原有 3 项及新加缩放验收项）。新验收通过 WebView2 的真实输入路径发送滚轮与键盘事件，使用生产前端消息适配模块接收原生状态。

观测结果：

- 单次 Ctrl + 向上滚轮：100% → 110%，没有二次放大。
- 普通滚轮：页面滚动 120 像素，比例仍为 100%。
- 聚焦输入框后，Ctrl + 滚轮与快捷键正常。
- 连续调整后分别停在 50%、200%；无效缩放命令被忽略。
- 刷新、切换全部 16 个页面及重开后仍为 125%。
- 渲染 DPI 100%、125%、150% 下仍为 125%，未叠加 CSS 缩放，也未重建浏览器。
- 缺失、损坏、超范围及字符串类型偏好均回落到 100%。

结果文件：桌面 `MES开发环境_v2.10.0/.mes/verification/test-zoom-20261113/page-zoom-results.json`。

### 实际组件渲染

隔离验收页面使用正式 `DesktopZoomControls.vue`、项目主题和各页头样式，通过编译后的真实测试终端读取 125% 状态并截图。

- 深浅主题：`actual-dark-125.png`、`actual-light-125.png`。
- 800 像素窗口 / 200% 页面缩放：中控、实验室、暂存间、接驳区四种页头的缩放与刷新控件都位于可视范围内。截图：`actual-narrow-200.png`；几何测量：`ui-layout-results.json`。

上述图片为实际组件的隔离验收图，未连接业务数据库。

## 使用新版

已在桌面 `MES开发环境_v2.10.0/测试终端/` 中原位更新。启动该目录内的 `MES综合测试终端.exe` 即可使用。

旧测试窗口已正常关闭后更新，原 `mes-client.json` 配置逐字节保留。本机登录及缩放偏好仍使用同一安装路径对应的目录。离线组件补全缓存与总文件校验同步更新，防止修复时恢复为旧版。

验证图片、原生测量及本报告副本保存在桌面 `MES开发环境_v2.10.0/.mes/verification/test-zoom-20261113/`。主项目中本轮生成的独立客户端目录和发布 ZIP 已移除；后续桌面交付更新沿用 v2.10 原目录。
