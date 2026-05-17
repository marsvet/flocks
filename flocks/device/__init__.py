"""Device integration domain — public API."""
from .models import (
    DEFAULT_GROUP_ID,
    DEFAULT_GROUP_NAME,
    MULTI_GROUP_ENABLED,
    DeviceGroup,
    DeviceGroupCreate,
    DeviceGroupUpdate,
    DeviceIntegration,
    DeviceIntegrationCreate,
    DeviceIntegrationUpdate,
    DeviceTestResult,
)
from .startup import device_startup
from .store import get_device_credentials

__all__ = [
    # Feature flags / constants
    "MULTI_GROUP_ENABLED",
    "DEFAULT_GROUP_ID",
    "DEFAULT_GROUP_NAME",
    # Models
    "DeviceGroup",
    "DeviceGroupCreate",
    "DeviceGroupUpdate",
    "DeviceIntegration",
    "DeviceIntegrationCreate",
    "DeviceIntegrationUpdate",
    "DeviceTestResult",
    # Entry points
    "device_startup",
    "get_device_credentials",
]
