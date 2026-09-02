"use client";

import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu } from "antd";
import {
  DollarOutlined,
  CheckCircleOutlined,
  BankOutlined,
  TeamOutlined,
  MessageOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  BarChartOutlined,
  DashboardOutlined,
  SettingOutlined,
  MailOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";

const { Sider } = Layout;

/** Entradas visibles para cualquier usuario autenticado. */
const menuItems = [
  {
    key: "/",
    icon: <DashboardOutlined />,
    label: "Dashboard",
  },
  {
    key: "/cartera",
    icon: <DollarOutlined />,
    label: "Cartera Vencida",
  },
  {
    key: "/cola-aprobacion",
    icon: <CheckCircleOutlined />,
    label: "Cola de Aprobación",
  },
  {
    key: "/conciliacion",
    icon: <BankOutlined />,
    label: "Conciliación",
  },
  {
    key: "/clientes",
    icon: <TeamOutlined />,
    label: "Clientes",
  },
  {
    key: "/conversaciones",
    icon: <MessageOutlined />,
    label: "Conversaciones",
  },
  {
    key: "/disputas",
    icon: <ExclamationCircleOutlined />,
    label: "Disputas",
  },
  {
    key: "/documentos",
    icon: <FileTextOutlined />,
    label: "Documentos",
  },
  {
    key: "/reportes",
    icon: <BarChartOutlined />,
    label: "Reportes",
  },
  {
    key: "/plantillas",
    icon: <MailOutlined />,
    label: "Plantillas",
  },
  {
    key: "/cadencias",
    icon: <ThunderboltOutlined />,
    label: "Cadencias",
  },
  {
    key: "/tareas",
    icon: <CalendarOutlined />,
    label: "Tareas",
  },
  {
    key: "/configuracion",
    icon: <SettingOutlined />,
    label: "Configuración",
  },
];

/** Entradas solo para ADMIN. La API las protege igual; esto es para no
 *  enseñar una puerta que va a devolver 403. */
const menuItemsAdmin = [
  {
    key: "/usuarios",
    icon: <UserSwitchOutlined />,
    label: "Usuarios",
  },
];

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  userRol?: string;
}

export default function Sidebar({ collapsed, onCollapse, userRol }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const items = userRol === "ADMIN" ? [...menuItems, ...menuItemsAdmin] : menuItems;

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={onCollapse}
      style={{
        overflow: "auto",
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
      }}
    >
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: collapsed ? 16 : 18,
          fontWeight: 700,
          letterSpacing: 1,
        }}
      >
        {collapsed ? "GK" : "GUIPAK"}
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[pathname]}
        items={items}
        onClick={({ key }) => router.push(key)}
      />
    </Sider>
  );
}
