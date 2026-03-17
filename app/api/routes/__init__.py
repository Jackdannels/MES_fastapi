def __getattr__(name: str):
    if name == "API_ROUTERS":
        from app.modules.registry import API_ROUTERS

        return API_ROUTERS
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["API_ROUTERS"]
