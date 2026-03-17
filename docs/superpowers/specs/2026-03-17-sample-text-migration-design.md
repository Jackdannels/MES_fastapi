# Sample Text Migration Design

**Goal**

把历史样品数据里的乱码文本迁移到后端持久化层处理，先完成数据清洗和自动迁移，再为后续删除前端兼容逻辑创造条件。

**现状**

- 当前仓库里的持久化文件 [`app/data/mes_store.json`](C:/Users/12051/Desktop/MES_fastapi/app/data/mes_store.json) 已经没有明显乱码样本。
- 前端仍保留两处历史兼容：
  - [`frontend/src/lib/storageApi.js`](C:/Users/12051/Desktop/MES_fastapi/frontend/src/lib/storageApi.js)
  - [`frontend/src/modules/samples/sampleTraceModel.js`](C:/Users/12051/Desktop/MES_fastapi/frontend/src/modules/samples/sampleTraceModel.js)
- 这说明当前系统不再主动产生乱码，但仍在兜底旧的 `mes.samples` 持久化数据和浏览器本地缓存。

**推荐方案**

在后端 `JsonFileStorage` 层为 `mes.samples` 增加标准化逻辑：

1. 读取 `mes.samples` 时递归清洗历史乱码文本。
2. 如果读出的内容发生变化，则自动回写到 `mes_store.json`，完成一次性迁移。
3. 写入 `mes.samples` 时也统一做同样清洗，确保以后不会把旧乱码重新写回持久化层。

**为什么放在后端**

- 后端是所有样品持久化数据的统一入口，覆盖面比页面层更完整。
- 迁移后，文件存储本身就变成干净数据，后续删除前端兼容逻辑风险更低。
- API 和本地开发都复用这套逻辑，不需要依赖某个页面是否被访问。

**暂不做的事**

- 本轮不删除前端兼容映射。
- 本轮不重构前后端共享清洗字典。
- 本轮不新增独立 CLI 迁移命令，优先让存储层自动完成迁移。

**验证方式**

- 新增后端测试，覆盖：
  - 读取含乱码的 `mes.samples` 时会返回清洗后的中文。
  - 读取后会把文件内容自动迁移并落盘。
  - 写入 `mes.samples` 时会落盘为清洗后的内容。
- 再跑后端相关测试和前端现有测试，确保兼容层暂时不受影响。
