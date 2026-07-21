from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "bip_tasks",
    broker=settings.get_redis_url(),
    backend=settings.get_redis_url()
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Europe/Istanbul",
    enable_utc=True,
)

# Autodiscover tasks from the workers package
celery_app.autodiscover_tasks(["app.workers"])
