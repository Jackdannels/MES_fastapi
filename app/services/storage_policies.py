STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES = {
    "送至实验室",
    "已到达实验室",
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
}

LAB_MAINTENANCE_BLOCKED_STATUSES = set(STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES)
SCHEDULE_LOCKED_AFTER_FIXTURE_STATUSES = {
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
    "实验已完成",
    "实验完成",
    "实验已经完成",
}
SCHEDULE_FIXTURE_LOCKED_DETAIL = "夹具安装后排程不可删除或重新排程。"
