/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEWGEN_DEVICES_API_BASE?: string;
  readonly VITE_NEWGEN_AUTH_API_BASE?: string;
  readonly VITE_NEWGEN_SMART_SWITCH_DEVICE_IDS?: string;
  readonly VITE_NEWGEN_GATEWAY_SOCKET_DEVICE_IDS?: string;
  readonly VITE_NEWGEN_LED_STRIP_DEVICE_IDS?: string;
  readonly VITE_NEWGEN_SMOKE_SENSOR_DEVICE_IDS?: string;
  readonly VITE_NEWGEN_HUMAN_SENSOR_DEVICE_IDS?: string;
  readonly VITE_ENABLE_MINIAPP_LOG_UI?: string;
  readonly VITE_ENABLE_DEVTOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
