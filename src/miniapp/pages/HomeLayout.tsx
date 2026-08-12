import React, { useState } from "react";
import { Alert, Button, Typography } from "antd";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MenuOutlined, ReloadOutlined, SettingOutlined, SearchOutlined } from "@ant-design/icons";
import { useMiniApp } from "../context/MiniAppContext";
import { formatPhone } from "../utils/phone";

export const HomeLayout: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { userPhone, authError, authLoading, requestAuthAndPhone } = useMiniApp();
  const location = useLocation();

  return (
    <div className="home-page home-page--motion">
      <div className="home-page__user-block" id="user-id">
        <Typography.Title level={4} className="home-page__user-greeting" style={{ margin: 0 }}>
          Nhà của tôi
        </Typography.Title>
        {userPhone ? (
          <Typography.Text type="secondary" className="home-page__user-phone">
            {formatPhone(userPhone)}
          </Typography.Text>
        ) : authError ? (
          <Typography.Text type="danger" className="home-page__user-phone">
            Chưa đăng nhập
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" italic className="home-page__user-phone">
            Đang đăng nhập…
          </Typography.Text>
        )}
      </div>

      {authError ? (
        <Alert
          type="error"
          showIcon
          message="Không thể đăng nhập"
          description={authError}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={authLoading}
              onClick={() => {
                void requestAuthAndPhone().catch(() => {});
              }}
            >
              Thử lại
            </Button>
          }
          style={{ margin: "0 16px 12px" }}
        />
      ) : null}

      <div className="home-page__tabs home-page__tabs--framer">
        <NavLink to="/" end className="home-page__tab-cell">
          {({ isActive }) => (
            <>
              <span className={`home-page__tabs-label ${isActive ? "active" : ""}`}>Smart Home</span>
              {isActive && (
                <motion.span
                  layoutId="home-tab-underline"
                  className="home-page__tabs-indicator"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
            </>
          )}
        </NavLink>
        <NavLink to="/shared" className="home-page__tab-cell">
          {({ isActive }) => (
            <>
              <span className={`home-page__tabs-label ${isActive ? "active" : ""}`}>Đã chia sẻ</span>
              {isActive && (
                <motion.span
                  layoutId="home-tab-underline"
                  className="home-page__tabs-indicator"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
            </>
          )}
        </NavLink>
        <button
          type="button"
          className="home-page__icon-menu"
          id="btn-menu"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <MenuOutlined />
        </button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              key="home-menu-overlay"
              className="home-page__menu-overlay home-page__menu-overlay--motion"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              aria-hidden={false}
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              key="home-menu-panel"
              id="home-menu"
              className="home-page__menu-dropdown home-page__menu-dropdown--drawer"
              initial={{ x: "102%" }}
              animate={{ x: 0 }}
              exit={{ x: "102%" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              aria-hidden={false}
            >
              <Link to="/" className="home-page__menu-item" onClick={() => setMenuOpen(false)}>
                Smart Home
              </Link>
              <Link to="/shared" className="home-page__menu-item" onClick={() => setMenuOpen(false)}>
                Đã chia sẻ
              </Link>
              <Link to="/nav-settings" className="home-page__menu-item" onClick={() => setMenuOpen(false)}>
                <span>Cài đặt điều hướng</span>
                <span className="home-page__menu-icon">
                  <SettingOutlined />
                </span>
              </Link>
              <Link to="/my-devices" className="home-page__menu-item" onClick={() => setMenuOpen(false)}>
                <span>Thiết bị của tôi</span>
                <span className="home-page__menu-icon">
                  <SearchOutlined />
                </span>
              </Link>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          className="home-page__tab-panel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
