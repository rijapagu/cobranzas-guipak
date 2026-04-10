"use client";

import { useRouter } from "next/navigation";
import { Layout, Dropdown, Button, Typography, Space } from "antd";
import { UserOutlined, LogoutOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";

const { Header: AntHeader } = Layout;
const { Text } = Typography;

interface HeaderProps {
  userName: string;
  userRol: string;
}

export default function Header({ userName, userRol }: HeaderProps) {
  const router = useRouter();

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
      label: "Cerrar sesi\u00f3n",
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
      <Dropdown menu={{ items }} placement="bottomRight" trigger={["click"]}>
        <Button type="text" icon={<UserOutlined />}>
          {userName}
        </Button>
      </Dropdown>
    </AntHeader>
  );
}
