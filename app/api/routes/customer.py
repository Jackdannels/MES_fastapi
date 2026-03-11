from app.api.routes.crud_factory import build_crud_router

router = build_crud_router("/customer", "customer", "Customer")
