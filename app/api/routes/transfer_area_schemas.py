from pydantic import BaseModel, ConfigDict, Field


DEFAULT_TRAY_LIMIT = 16
MAX_TRAY_LIMIT = 16
TRAY_QR_TYPE = "QRCODE"


class TrayAllocationPayload(BaseModel):
    tray_id: int = Field(alias="trayId")
    sample_ids: list[str] = Field(default_factory=list, alias="sampleIds")

    model_config = ConfigDict(populate_by_name=True)


class ExperimentTrayAllocationPayload(BaseModel):
    experiment_code: str = Field(alias="experimentCode")
    tray_ids: list[int] = Field(default_factory=list, alias="trayIds")

    model_config = ConfigDict(populate_by_name=True)


class TaskAllocationRequest(BaseModel):
    tray_limit: int = Field(default=DEFAULT_TRAY_LIMIT, alias="trayLimit", ge=1, le=MAX_TRAY_LIMIT)
    trays: list[TrayAllocationPayload] = Field(default_factory=list)
    experiment_trays: list[ExperimentTrayAllocationPayload] = Field(default_factory=list, alias="experimentTrays")

    model_config = ConfigDict(populate_by_name=True)


class TrayPrintBarcodeRequest(BaseModel):
    barcode_type: str = Field(default=TRAY_QR_TYPE, alias="barcodeType")

    model_config = ConfigDict(populate_by_name=True)


class TrayDispatchRequest(BaseModel):
    target_type: str = Field(alias="targetType")
    target_name: str = Field(alias="targetName")
    experiment_code: str = Field(default="", alias="experimentCode")

    model_config = ConfigDict(populate_by_name=True)


class TrayWithdrawDispatchRequest(BaseModel):
    reason: str = ""

    model_config = ConfigDict(populate_by_name=True)
