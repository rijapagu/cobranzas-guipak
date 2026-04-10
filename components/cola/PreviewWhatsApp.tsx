"use client";

import { Typography } from "antd";
import { WhatsAppOutlined } from "@ant-design/icons";

const { Text } = Typography;

export default function PreviewWhatsApp({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return <Text type="secondary">Sin mensaje WhatsApp</Text>;

  return (
    <div style={{ maxWidth: 400 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <WhatsAppOutlined style={{ color: "#25D366", fontSize: 16 }} />
        <Text strong style={{ fontSize: 13 }}>WhatsApp</Text>
      </div>
      <div
        style={{
          background: "#dcf8c6",
          borderRadius: "8px 8px 8px 0",
          padding: "10px 14px",
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          boxShadow: "0 1px 1px rgba(0,0,0,0.1)",
        }}
      >
        {mensaje}
      </div>
      <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
        {mensaje.length} caracteres
      </Text>
    </div>
  );
}
