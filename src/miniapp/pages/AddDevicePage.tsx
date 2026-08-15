import React, { useEffect, useMemo, useRef, useState } from "react";
import { Typography } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { BulbOutlined, FireOutlined, LeftOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { createAndStoreDevice } from "../services/deviceSync";
import { useMiniApp } from "../context/MiniAppContext";
import { fetchNewgenRooms, type NewgenPlatformRoom } from "../services/newgenPlatform";

type DeviceTemplate = {
  key: string;
  title: string;
  type: string;
  labelPrefix: string;
};

const DEVICE_TEMPLATES: DeviceTemplate[] = [
  { key: "temp", title: "Cảm biến nhiệt độ", type: "Temperature Sensor", labelPrefix: "Temperature Sensor" },
  { key: "light", title: "Đèn thông minh", type: "Light", labelPrefix: "Smart Light" },
  { key: "switch", title: "Công tắc thông minh", type: "Switch", labelPrefix: "Smart Switch" },
];

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  temp: <FireOutlined />,
  light: <BulbOutlined />,
  switch: <ThunderboltOutlined />,
};

export const AddDevicePage: React.FC = () => {
  const navigate = useNavigate();
  const { userPhone, refreshDevices } = useMiniApp();
  const qrInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>(DEVICE_TEMPLATES[0].key);
  const [deviceSerial, setDeviceSerial] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [rooms, setRooms] = useState<NewgenPlatformRoom[]>([]);
  const [roomId, setRoomId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchNewgenRooms()
      .then((items) => {
        if (cancelled) return;
        setRooms(items);
        setRoomId((current) => current || items[0]?.id || "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const username = useMemo(() => {
    const raw = String(userPhone || "").trim();
    if (!raw) return "";
    return raw.startsWith("+") ? raw.replace(/[^\d]/g, "") : raw;
  }, [userPhone]);

  const selectedTemplate = useMemo(
    () => DEVICE_TEMPLATES.find((x) => x.key === selectedTemplateKey) ?? DEVICE_TEMPLATES[0],
    [selectedTemplateKey],
  );

  const payload = useMemo(
    () => ({
      name: (deviceSerial.trim() || `DEVICE_${Date.now()}`).toUpperCase(),
      type: selectedTemplate.type,
      label: `${selectedTemplate.labelPrefix}${deviceSerial.trim() ? ` - ${deviceSerial.trim().toUpperCase()}` : ""}`,
      room_id: roomId,
    }),
    [deviceSerial, roomId, selectedTemplate],
  );

  const applyTemplate = (tpl: DeviceTemplate) => {
    setSelectedTemplateKey(tpl.key);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText("");
    setSuccessText("");

    if (!username) {
      setErrorText("Chưa có username/số điện thoại từ auth.");
      return;
    }
    if (!payload.name || !payload.type) {
      setErrorText("Thiếu thông tin thiết bị.");
      return;
    }
    if (!roomId) {
      setErrorText("Tài khoản chưa có phòng để thêm thiết bị.");
      return;
    }

    setSubmitting(true);
    try {
      const saved = await createAndStoreDevice(username, payload);
      await refreshDevices();
      const id = String(saved.deviceId ?? saved.device?.id?.id ?? "");
      const name = String(saved.name ?? saved.device?.name ?? "");
      setSuccessText(`Đã tạo và lưu thành công. ${name ? `Tên: ${name}.` : ""} ${id ? `ID: ${id}` : ""}`.trim());
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onQrPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setErrorText("");
    setSuccessText("Đã mở camera/chọn ảnh QR.");
    try {
      if (!("BarcodeDetector" in window)) {
        setSuccessText("Đã chụp ảnh QR. Thiết bị chưa hỗ trợ đọc QR tự động, bạn nhập serial thủ công.");
        return;
      }

      const DetectorCtor = window.BarcodeDetector;
      if (!DetectorCtor) {
        setSuccessText("Đã chụp ảnh QR. Thiết bị chưa hỗ trợ đọc QR tự động, bạn nhập serial thủ công.");
        return;
      }
      const detector = new DetectorCtor({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (codes.length > 0 && codes[0].rawValue) {
        const value = String(codes[0].rawValue).trim();
        setDeviceSerial(value);
        setSuccessText("Đã quét QR thành công, đã điền serial.");
      } else {
        setSuccessText("Không đọc được QR từ ảnh, vui lòng nhập serial thủ công.");
      }
    } catch {
      setSuccessText("Không đọc được QR từ ảnh, vui lòng nhập serial thủ công.");
    }
  };

  return (
    <div className="add-device-page">
      <div className="add-device-page__header">
        <Link to="/" className="add-device-page__back btn-back" aria-label="Quay lại">
          <span className="btn-back-arrow">
            <LeftOutlined />
          </span>
        </Link>
        <Typography.Title level={4} className="add-device-page__title" style={{ margin: 0, flex: 1 }}>
          Thêm thiết bị
        </Typography.Title>
      </div>

      <div className="add-device-page__body">
        <div className="add-device-page__steps" aria-label="Các bước">
          <span className="add-device-page__step add-device-page__step--on">1. Chọn loại</span>
          <span className="add-device-page__steps-sep" aria-hidden>
            →
          </span>
          <span className="add-device-page__step">2. Quét / nhập serial</span>
        </div>

        <div className="add-device-page__account">
          <Typography.Text type="secondary" className="add-device-page__account-line">
            Tài khoản: <strong>{username || "Chưa có username từ Tammi"}</strong>
          </Typography.Text>
        </div>

        <form onSubmit={onSubmit} className="add-device-page__section add-device-page__form">
          <input
            ref={qrInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onQrPick}
            className="add-device-page__file-input"
          />
          <button
            type="button"
            onClick={() => qrInputRef.current?.click()}
            className="add-device-page__qr-btn add-device-page__qr-btn--primary"
          >
            Quét QR
          </button>
          <Typography.Paragraph type="secondary" className="add-device-page__qr-hint" style={{ margin: 0 }}>
            Mở camera để quét mã — nhanh nhất để lấy serial.
          </Typography.Paragraph>

          <Typography.Title level={5} className="add-device-page__section-title add-device-page__section-title--tight">
            Loại thiết bị
          </Typography.Title>
          <div className="add-device-page__template-grid">
            {DEVICE_TEMPLATES.map((tpl) => {
              const active = tpl.key === selectedTemplate.key;
              return (
                <button
                  key={tpl.key}
                  type="button"
                  className={`add-device-page__template-card ${active ? "add-device-page__template-card--active" : ""}`}
                  onClick={() => applyTemplate(tpl)}
                  aria-pressed={active}
                >
                  <span className="add-device-page__template-card-icon">{TEMPLATE_ICONS[tpl.key]}</span>
                  <span className="add-device-page__template-card-title">{tpl.title}</span>
                  <span className="add-device-page__template-card-type">{tpl.type}</span>
                </button>
              );
            })}
          </div>

          <div className="add-device-page__serial-group">
            <label className="add-device-page__serial-label">Phòng</label>
            <select
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              className="add-device-page__serial-input"
              disabled={rooms.length === 0}
            >
              {rooms.length === 0 ? (
                <option value="">Tài khoản chưa có phòng</option>
              ) : rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.apartmentName ? `${room.apartmentName} — ` : ""}{room.name}
                </option>
              ))}
            </select>
          </div>

          <div className="add-device-page__serial-group">
            <label className="add-device-page__serial-label">Serial / Mã thiết bị</label>
            <input
              value={deviceSerial}
              onChange={(e) => setDeviceSerial(e.target.value)}
              placeholder="VD: A4B72CCDFF33"
              className="add-device-page__serial-input"
            />
          </div>
          <Typography.Paragraph type="secondary" className="add-device-page__note" style={{ margin: 0 }}>
            App sẽ tự tạo payload theo loại bạn đã chọn.
          </Typography.Paragraph>

          <div className="add-device-page__actions">
            <button
              type="submit"
              disabled={submitting || !roomId}
              className="add-device-page__submit-btn"
            >
              {submitting ? "Đang thêm thiết bị..." : "Thêm"}
            </button>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="add-device-page__home-btn"
            >
              Về Smart Home
            </button>
          </div>
        </form>

        {errorText && (
          <div className="add-device-page__feedback add-device-page__feedback--error">
            {errorText}
          </div>
        )}
        {successText && (
          <div className="add-device-page__feedback add-device-page__feedback--success">
            {successText}
          </div>
        )}
      </div>
    </div>
  );
};

