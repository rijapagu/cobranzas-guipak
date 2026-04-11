"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Layout, Dropdown, Button, Typography, Space, Badge, Tooltip } from "antd";
import { UserOutlined, LogoutOutlined, BellOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";

const { Header: AntHeader } = Layout;
const { Text } = Typography;

interface HeaderProps {
  userName: string;
  userRol: string;
}

export default function Header({ userName, userRol }: HeaderProps) {
  const router = useRouter();
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    fetch("/api/cobranzas/alertas")
      .then(res => res.json())
      .then(data => setAlertCount(data.resumen?.alta || 0))
      .catch(() => {});

    // Refrescar cada 5 minutos
    const interval = setInterval(() => {
      fetch("/api/cobranzas/alertas")
        .then(res => res.json())
        .then(data => setAlertCount(data.resumen?.alta || 0))
        .catch(() => {});
    }, 300000);

    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const items: MenuProps["items"] = [
    {
      key: "user-info",
      label: (
        <Space direction="vertical" size={0}>
          <Text strong>{userName}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {userRol}
          </Text>
        </Space>
      ),
      disabled: true,
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "Cerrar sesión",
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <AntHeader
      style={{
        padding: "0 24px",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid #f0f0f0",
      }}
    >
      <Text strong style={{ fontSize: 16 }}>
        Sistema de Cobranzas
      </Text>
      <Space size={16}>
        <Tooltip title={alertCount > 0 ? `${alertCount} alerta${alertCount > 1 ? 's' : ''} de alta prioridad` : 'Sin alertas'}>
          <Badge count={alertCount} size="small">
            <Button type="text" icon={<BellOutlined />} onClick={() => router.push("/")} />
          </Badge>
        </Tooltip>
        <Dropdown menu={{ items }} placement="bottomRight" trigger={["click"]}>
          <Button type="text" icon={<UserOutlined />}>
            {userName}
          </Button>
        </Dropdown>
      </Space>
    </AntHeader>
  );
}
