"""Build the desktop editor catalogue without importing application settings.

Run after adding Settings fields. Docker availability is derived from Compose,
so the editor never offers a backend key that Compose does not pass through.
"""
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LABELS = {
    "MYSQL_HOST": "数据库主机", "MYSQL_PORT": "数据库端口", "MYSQL_USER": "数据库连接用户",
    "MYSQL_PASSWORD": "数据库连接密码", "MYSQL_DATABASE": "数据库名称",
    "MYSQL_POOL_SIZE": "连接池大小", "MYSQL_POOL_TIMEOUT_SECONDS": "连接池等待秒数",
    "RABBITMQ_URL": "AMQP 连接地址（含账号密码）", "RABBITMQ_ENABLED": "启用 RabbitMQ",
    "RABBITMQ_REQUIRED": "启动时要求 RabbitMQ 就绪", "RABBITMQ_PREFETCH_COUNT": "消息预取数量",
    "RABBITMQ_COMMAND_EXCHANGE": "LIMS 指令交换机", "RABBITMQ_EVENT_EXCHANGE": "MES 事件交换机",
    "RABBITMQ_DLX_EXCHANGE": "死信交换机", "RABBITMQ_INTAKE_QUEUE": "任务接收队列",
    "RABBITMQ_INTAKE_ROUTING_KEY": "任务接收路由键", "RABBITMQ_STATUS_QUEUE": "任务状态队列",
    "MQTT_ENABLED": "启用 MQTT", "MQTT_HOST": "MQTT 主机", "MQTT_PORT": "MQTT 端口",
    "MQTT_USERNAME": "MQTT 用户名", "MQTT_PASSWORD": "MQTT 密码", "MQTT_QOS": "消息服务质量 QoS",
    "MQTT_TOPIC_PREFIX": "MQTT 主题前缀", "MQTT_CONNECT_TIMEOUT_SECONDS": "MQTT 连接超时秒数",
    "MQTT_PUBLISH_TIMEOUT_SECONDS": "MQTT 发布超时秒数",
    "LIMS_HTTP_CALLBACK_URL": "MES 向 LIMS 发送事件的 HTTP 地址", "LIMS_HEALTH_URL": "LIMS 状态查询地址",
    "LIMS_COMMUNICATION_URL": "LIMS 通信检测地址", "LIMS_HTTP_TOKEN": "LIMS HTTP 认证令牌",
    "LIMS_MES_BASE_URL": "LIMS 模拟器访问 MES 的地址", "LIMS_DATA_PUBLIC_BASE_URL": "LIMS 数据公开访问根地址",
    "LIMS_HTTP_TIMEOUT_SECONDS": "LIMS HTTP 超时秒数", "LIMS_COMMUNICATION_ENABLED": "启用 LIMS 通信检测",
    "LIMS_COMMUNICATION_INTERVAL_SECONDS": "通信检测间隔秒数", "LIMS_COMMUNICATION_RETRY_SECONDS": "通信重试间隔秒数",
    "FRONTEND_ORIGINS": "允许访问 API 的前端地址（逗号分隔）",
    "TEST_DATA_PUBLIC_BASE_URL": "试验数据分享根地址", "TEST_DATA_SAVE_PATH": "试验报告保存目录",
    "TEST_DATA_BACKUP_PATH": "试验数据备份目录", "TEST_DATA_BACKUP_STATE_PATH": "本地备份队列文件",
    "SESSION_IDLE_TIMEOUT_MINUTES": "登录空闲超时分钟数", "SESSION_MAX_AGE_HOURS": "登录最长有效小时数",
    "SESSION_SECRET_KEY": "登录会话签名密钥", "DEMO_USER": "登录用户", "DEMO_PASSWORD": "登录密码",
}

# Only these day-to-day settings appear in the page. Keep the full catalogue
# for validation; displaying a field never supplies a value from this schema.
IMPORTANT = {
    "MYSQL_HOST": "MES 连接的 MySQL 服务器 IP 或域名，不带 http://。",
    "MYSQL_PORT": "MySQL 的连接端口，填写目标数据库实际监听的端口。",
    "MYSQL_DATABASE": "保存 MES 业务数据的数据库名称；修改后连接到新库，不迁移原有数据。",
    "MYSQL_USER": "连接业务数据库使用的账号，需已在目标数据库中创建并授权。",
    "MYSQL_PASSWORD": "数据库连接账号的密码，需与目标数据库一致。",
    "RABBITMQ_URL": "LIMS 与 MES 的 AMQP 连接地址，包含协议、账号、密码、主机、端口和虚拟主机。",
    "RABBITMQ_COMMAND_EXCHANGE": "LIMS 向 MES 发送业务指令的交换机名称，双方配置需一致。",
    "RABBITMQ_INTAKE_QUEUE": "MES 接收 LIMS 下发任务的队列名称。",
    "RABBITMQ_INTAKE_ROUTING_KEY": "LIMS 任务消息的路由键，发送端与接收端需匹配。",
    "MQTT_ENABLED": "是否连接上位机 MQTT 服务；实验准备、开始和结束依赖该连接。",
    "MQTT_HOST": "上位机消息服务的 IP 或域名，不带 mqtt:// 或 http://。",
    "MQTT_PORT": "上位机消息服务的 MQTT 端口，需与消息服务监听端口一致。",
    "MQTT_USERNAME": "登录 MQTT 服务的用户名；Docker 未单独设置时沿用内置消息服务账号。",
    "MQTT_PASSWORD": "登录 MQTT 服务的密码；修改连接参数不会修改服务端账号。",
    "MQTT_TOPIC_PREFIX": "上位机消息主题的统一前缀，MES 与上位机需使用相同前缀。",
    "FRONTEND_ORIGINS": "允许浏览器跨域访问 MES API 的前端地址，多个地址用英文逗号分隔。",
    "LIMS_HTTP_CALLBACK_URL": "MES 向 LIMS 发送试验事件的 HTTP 接口；留空时暂停通知发送。",
    "LIMS_HEALTH_URL": "MES 查询 LIMS 连接状态的 HTTP 接口，应返回 connected 状态。",
    "LIMS_COMMUNICATION_URL": "MES 与 LIMS 通信检测的 HTTP 接口；留空时按回调地址推导。",
    "LIMS_HTTP_TOKEN": "MES 与 LIMS HTTP 通信共用的认证令牌，双方需填写相同内容。",
    "LIMS_MES_BASE_URL": "LIMS 模拟器访问 MES API 的根地址；这是模拟器的出站地址。",
    "LIMS_DATA_PUBLIC_BASE_URL": "LIMS 可访问的试验数据根地址；留空时尝试沿用显式的数据分享地址。",
    "LIMS_HTTP_TIMEOUT_SECONDS": "调用 LIMS HTTP 接口的最长等待时间，单位为秒。",
    "TEST_DATA_PUBLIC_BASE_URL": "试验数据分享链接的根地址；填 auto 或留空时按访问 MES 的地址生成。",
    "TEST_DATA_SAVE_PATH": "试验报告在服务端的保存目录，填写服务所在环境的绝对路径。",
    "TEST_DATA_BACKUP_PATH": "启动时的额外备份目录，留空时关闭；若已在网页单独设置备份目录，以网页设置为准。",
    "DEMO_USER": "本地或安装环境的登录用户名，与人员维护中的员工账号分开管理。",
    "DEMO_PASSWORD": "本地或安装环境的登录密码，与人员维护中的员工密码分开管理。",
    "SESSION_IDLE_TIMEOUT_MINUTES": "连续无操作后登录失效的时间，单位为分钟；0 表示不限制。",
    "SESSION_MAX_AGE_HOURS": "一次登录最多保持的时间，单位为小时；0 表示不限制。",
}

DOCKER_FIELDS = {
    "MYSQL_API_USER": ("数据库连接用户", "数据库", "Docker 内置数据库的应用账号，MES 未单独设置 MYSQL_USER 时沿用此值。"),
    "MYSQL_API_PASSWORD": ("数据库连接密码", "数据库", "Docker 应用账号的连接密码；已有数据卷中的账号密码需由数据库管理员另行修改。"),
    "RABBITMQ_USER": ("内置消息服务用户名", "RabbitMQ / AMQP", "Docker 内置 RabbitMQ 的账号，未设置独立连接时供 AMQP 和 MQTT 共用。"),
    "RABBITMQ_PASSWORD": ("内置消息服务密码", "RabbitMQ / AMQP", "Docker 内置 RabbitMQ 账号的连接密码，需与消息服务现有账号一致。"),
    "MES_LOGIN_USER": ("登录用户", "登录与会话", IMPORTANT["DEMO_USER"]),
    "MES_LOGIN_PASSWORD": ("登录密码", "登录与会话", IMPORTANT["DEMO_PASSWORD"]),
    "MES_FRONTEND_ORIGINS": ("允许访问 API 的前端地址", "HTTP / LIMS", IMPORTANT["FRONTEND_ORIGINS"]),
}


def generate():
    tree = ast.parse((ROOT / "app/core/config.py").read_text(encoding="utf-8-sig"))
    settings = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Settings")
    compose = (ROOT / "compose.portable.yml").read_text(encoding="utf-8-sig")
    compose += (ROOT / "compose.portable.simulators.yml").read_text(encoding="utf-8-sig")
    docker_keys = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", compose))
    catalogue = []
    for node in settings.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        key = node.target.id
        if not key.isupper():
            continue
        annotation = ast.unparse(node.annotation)
        value = node.value
        limits = {}
        if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "Field":
            kwargs = {item.arg: item.value for item in value.keywords}
            value = kwargs.get("default")
            for name in ("ge", "gt", "le", "lt"):
                if name in kwargs:
                    limits[name] = ast.literal_eval(kwargs[name])
        try:
            default = ast.literal_eval(value)
        except (ValueError, TypeError):
            default = None
        kind = "bool" if "bool" in annotation else "int" if "int" in annotation else "number" if "float" in annotation else "text"
        if key.endswith("_PORT"):
            limits.update(ge=1, le=65535)
        if key == "MQTT_QOS":
            limits.update(ge=0, le=2)
        if key.startswith("MYSQL_") or key == "STORAGE_BACKEND":
            group = "数据库"
        elif key.startswith("RABBITMQ_"):
            group = "RabbitMQ / AMQP"
        elif key.startswith("MQTT_") or key.startswith("TELEMETRY_"):
            group = "MQTT / 上位机"
        elif key.startswith("LIMS_") or key == "FRONTEND_ORIGINS":
            group = "HTTP / LIMS"
        elif key.startswith("TEST_DATA_"):
            group = "文件与备份"
        elif key.startswith("SESSION_") or key.startswith("DEMO_"):
            group = "登录与会话"
        else:
            group = "其他参数"
        if isinstance(default, bool):
            default = str(default).lower()
        elif default is not None:
            default = str(default)
        catalogue.append(dict(Key=key, Label=LABELS.get(key, key), Group=group, Kind=kind,
                              Default=default, Secret=bool(re.search("PASSWORD|TOKEN|SECRET|DSN|RABBITMQ_URL", key)),
                              Docker=key in docker_keys, Limits=limits, Important=key in IMPORTANT,
                              Description=IMPORTANT.get(key, ""), DockerOnly=False))
    for key, (label, group, description) in DOCKER_FIELDS.items():
        catalogue.append(dict(Key=key, Label=label, Group=group, Kind="text", Default=None,
                              Secret="PASSWORD" in key, Docker=key in docker_keys, Limits={},
                              Important=True, Description=description, DockerOnly=True))
    target = ROOT / "tools/control-center/MESConfigurationSchema.json"
    target.write_text("[\n" + ",\n".join("  " + json.dumps(field, ensure_ascii=False) for field in catalogue) + "\n]\n", encoding="utf-8")


if __name__ == "__main__":
    generate()
