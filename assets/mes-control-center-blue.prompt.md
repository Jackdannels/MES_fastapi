# 控制中心蓝色轨道图标

依据用户于 2026-11-12 指定的蓝色轨道与四向星芒图案制作，采用内置 image_gen 处理高清底稿，输出 PNG，再通过 System.Drawing 包装为 Windows ICO。

当前采用用户最后指定的蓝色标识。

## 生成提示词

Prepare a faithful high-resolution square version of the original blue technology logo on clean white. Preserve original proportions and tilted elliptical geometry: interrupted deep-indigo outer orbital arcs and a flowing cyan inner elliptical loop with four sharp narrow north/east/south/west axis tips. Keep negative spaces empty white, with smooth contours and clear margin. No university elements, captions, text, shadows or other symbols. The asset is for the MES control-center Windows icon.

## 文件

- `mes-control-center-blue.png`：高清图标底稿。
- `mes-control-center-blue.ico`：16、20、24、32、40、48、64、128、256 像素帧。
- 转换脚本：`scripts/Convert-ControlCenterIcon.ps1`。

控制中心构建脚本直接读取该 ICO，避免重新生成旧图案。图标同时嵌入 EXE 的外壳图标与内部界面资源。
