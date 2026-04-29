def __getattr__(name: str):
    if name == "API_ROUTERS":
        from app.modules.registry import API_ROUTERS

        return API_ROUTERS
    if name == "transfer_area":
        from app.api.routes import transfer_area

        return transfer_area
    if name == "mq":
        from app.api.routes import mq

        return mq
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["API_ROUTERS", "transfer_area", "mq"]
