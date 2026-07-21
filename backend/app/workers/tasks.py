from app.workers.celery_app import celery_app
import logging

logger = logging.getLogger(__name__)

@celery_app.task(name="app.workers.tasks.test_task")
def test_task():
    logger.info("Executing test task...")
    return "Celery is working!"
