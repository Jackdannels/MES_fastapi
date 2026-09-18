import re

from fastapi import HTTPException

INTERNAL_TASK_PREFIX = "SYLUN"
EXTERNAL_TASK_PREFIX = "SYLUW"


def validate_task_code_source(code: str, *, external: bool) -> str:
    normalized = str(code or "").strip()
    prefix = EXTERNAL_TASK_PREFIX if external else INTERNAL_TASK_PREFIX
    match = re.fullmatch(rf"{prefix}-\d{{4}}-(?:0[1-9]|1[0-2])-(\d{{3,}})", normalized)
    if not match or int(match.group(1)) == 0:
        source = "外部委托" if external else "内部新增"
        raise HTTPException(status_code=400, detail=f"{source}任务编号必须为 {prefix}-YYYY-MM-流水号（至少三位，且大于零）")
    return normalized
