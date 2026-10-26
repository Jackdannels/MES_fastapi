// The original backend error is retained in the details; this only provides a readable summary.
export function describeBackupError(value) {
  const text = String(value || "");
  if (/ENOENT|No such file or directory|\[Errno 2\]|\[WinError [23]\]|系统找不到|不存在/i.test(text)) {
    return {
      title: "备份文件或目录不存在",
      hint: "请检查对应文件是否存在，以及备份路径是否可达。",
    };
  }
  if (/EACCES|EPERM|Permission denied|Access is denied|\[Errno 13\]|\[WinError 5\]|拒绝访问|权限不足/i.test(text)) {
    return {
      title: "备份访问权限不足",
      hint: "请检查备份目录及文件的读写权限。",
    };
  }
  if (/timed?\s*out|timeout|超时/i.test(text)) {
    return {
      title: "备份连接超时",
      hint: "请检查共享目录的网络连接，稍后刷新状态。",
    };
  }
  if (/network path|network is unreachable|connection refused|\[WinError (53|67)\]|网络路径|网络不可达/i.test(text)) {
    return {
      title: "备份路径无法连接",
      hint: "请检查共享地址及服务器的网络连接。",
    };
  }
  return {
    title: "备份未完成",
    hint: "请展开错误详情确认原因，再检查对应文件和备份路径。",
  };
}
