"""
Enterprise-grade logging configuration for Azure Architect API.
Provides structured, production-ready logging with correlation tracking.
"""
import logging
import sys
import uuid
import time
from typing import Optional
from contextvars import ContextVar
from functools import wraps

# Context variable for request correlation
correlation_id_var: ContextVar[str] = ContextVar('correlation_id', default='-')


class CorrelationFilter(logging.Filter):
    """Adds correlation ID to all log records for request tracing."""
    
    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = correlation_id_var.get('-')
        return True


class StructuredFormatter(logging.Formatter):
    """
    Enterprise-grade structured log formatter.
    Format: TIMESTAMP | LEVEL | CORRELATION_ID | LOGGER | MESSAGE
    """
    
    def format(self, record: logging.LogRecord) -> str:
        # Ensure correlation_id exists
        if not hasattr(record, 'correlation_id'):
            record.correlation_id = '-'
        
        # Format timestamp in ISO 8601
        timestamp = self.formatTime(record, '%Y-%m-%dT%H:%M:%S.') + f'{int(record.msecs):03d}Z'
        
        # Build structured log line
        log_line = (
            f"{timestamp} | "
            f"{record.levelname:8s} | "
            f"{record.correlation_id:36s} | "
            f"{record.name:40s} | "
            f"{record.getMessage()}"
        )
        
        # Add exception info if present
        if record.exc_info:
            log_line += f"\n{self.formatException(record.exc_info)}"
        
        return log_line


def generate_correlation_id() -> str:
    """Generate a unique correlation ID for request tracing."""
    return str(uuid.uuid4())


def set_correlation_id(correlation_id: Optional[str] = None) -> str:
    """Set correlation ID for the current context."""
    cid = correlation_id or generate_correlation_id()
    correlation_id_var.set(cid)
    return cid


def get_correlation_id() -> str:
    """Get the current correlation ID."""
    return correlation_id_var.get('-')


def setup_logging(level: str = "INFO", log_format: Optional[str] = None) -> None:
    """
    Configure enterprise-grade application logging.
    
    Features:
    - Structured log format with timestamps
    - Correlation ID tracking for request tracing
    - Configurable log levels
    - Reduced noise from third-party libraries
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_format: Custom log format string (ignored, uses StructuredFormatter)
    """
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)
    
    # Clear existing handlers to avoid duplicate logs
    root_logger.handlers.clear()
    
    # Create console handler with structured formatter
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)
    console_handler.setFormatter(StructuredFormatter())
    console_handler.addFilter(CorrelationFilter())
    root_logger.addHandler(console_handler)
    
    # Configure application loggers
    app_loggers = [
        'app',
        'app.api',
        'app.api.endpoints',
        'app.api.endpoints.chat',
        'app.agents',
        'app.agents.azure_architect_agent',
        'app.core',
        'app.deps'
    ]
    
    for logger_name in app_loggers:
        app_logger = logging.getLogger(logger_name)
        app_logger.setLevel(numeric_level)
        app_logger.propagate = True
    
    # Reduce noise from third-party libraries
    third_party_levels = {
        "uvicorn": logging.INFO,
        "uvicorn.access": logging.WARNING,
        "uvicorn.error": logging.INFO,
        "httpx": logging.WARNING,
        "httpcore": logging.WARNING,
        "openai": logging.WARNING,
        "openai._base_client": logging.WARNING,
        "asyncio": logging.WARNING,
        "watchfiles": logging.WARNING,
    }
    
    for logger_name, log_level in third_party_levels.items():
        logging.getLogger(logger_name).setLevel(log_level)
    
    # Log initialization
    logger = logging.getLogger(__name__)
    logger.info(f"Logging initialized | level={level} | format=structured")


def get_logger(name: str) -> logging.Logger:
    """Get a named logger instance with correlation tracking."""
    return logging.getLogger(name)


def log_operation(operation_name: str):
    """
    Decorator for logging operation start/end with timing.
    
    Usage:
        @log_operation("generate_bicep")
        async def my_function():
            ...
    """
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            logger = logging.getLogger(func.__module__)
            start_time = time.perf_counter()
            logger.info(f"Operation started | operation={operation_name}")
            try:
                result = await func(*args, **kwargs)
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                logger.info(f"Operation completed | operation={operation_name} | duration_ms={elapsed_ms:.2f}")
                return result
            except Exception as e:
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                logger.error(f"Operation failed | operation={operation_name} | duration_ms={elapsed_ms:.2f} | error={str(e)}")
                raise
        
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            logger = logging.getLogger(func.__module__)
            start_time = time.perf_counter()
            logger.info(f"Operation started | operation={operation_name}")
            try:
                result = func(*args, **kwargs)
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                logger.info(f"Operation completed | operation={operation_name} | duration_ms={elapsed_ms:.2f}")
                return result
            except Exception as e:
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                logger.error(f"Operation failed | operation={operation_name} | duration_ms={elapsed_ms:.2f} | error={str(e)}")
                raise
        
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    return decorator
