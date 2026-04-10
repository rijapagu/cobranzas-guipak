"use client";

import { Space, Tooltip } from "antd";
import {
  WhatsAppOutlined,
  MailOutlined,
  FilePdfOutlined,
  WarningOutlined,
} from "@ant-design/icons";

interface Props {
  telefono: string | null;
  email: string | null;
  tiene_pdf?: boolean;
}

export default function ContactoIndicadores({ telefono, email, tiene_pdf }: Props) {
  const sinContacto = !telefono && !email;

  return (
    <Space size={4}>
      {telefono ? (
        <Tooltip title={`WhatsApp: ${telefono}`}>
          <WhatsAppOutlined style={{ color: "#25D366", fontSize: 16 }} />
        </Tooltip>
      ) : (
        <Tooltip title="Sin WhatsApp">
          <WhatsAppOutlined style={{ color: "#d9d9d9", fontSize: 16 }} />
        </Tooltip>
      )}
      {email ? (
        <Tooltip title={email}>
          <MailOutlined style={{ color: "#1890ff", fontSize: 16 }} />
        </Tooltip>
      ) : (
        <Tooltip title="Sin email">
          <MailOutlined style={{ color: "#d9d9d9", fontSize: 16 }} />
        </Tooltip>
      )}
      {tiene_pdf && (
        <Tooltip title="PDF disponible">
          <FilePdfOutlined style={{ color: "#cf1322", fontSize: 16 }} />
        </Tooltip>
      )}
      {sinContacto && (
        <Tooltip title="Sin datos de contacto">
          <WarningOutlined style={{ color: "#faad14", fontSize: 16 }} />
        </Tooltip>
      )}
    </Space>
  );
}
