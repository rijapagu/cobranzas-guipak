"use client";

import { useState, useEffect } from "react";
import { Layout } from "antd";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import AsistenteChat from "@/components/asistente/AsistenteChat";

const { Content } = Layout;

interface UserInfo {
  nombre: string;
  rol: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<UserInfo>({ nombre: "", rol: "" });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUser({ nombre: data.user.nombre, rol: data.user.rol });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: "all 0.2s" }}>
        <Header userName={user.nombre} userRol={user.rol} />
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: "#fff",
            borderRadius: 8,
            minHeight: 280,
          }}
        >
          {children}
        </Content>
      </Layout>
      <AsistenteChat />
    </Layout>
  );
}
