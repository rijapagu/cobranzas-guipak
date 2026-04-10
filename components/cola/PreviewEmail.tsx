"use client";

import { Typography, Card } from "antd";
import { MailOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;

interface Props {
  asunto: string | null;
  mensaje: string | null;
}

export default function PreviewEmail({ asunto, mensaje }: Props) {
  if (!mensaje) return <Text type="secondary">Sin mensaje Email</Text>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <MailOutlined style={{ color: "#1890ff", fontSize: 16 }} />
        <Text strong style={{ fontSize: 13 }}>Email</Text>
      </div>
      <Card size="small" style={{ background: "#fafafa" }}>
        <div style={{ borderBottom: "1px solid #f0f0f0", paddingBottom: 8, marginBottom: 8 }}>
          <Text strong>Asunto: </Text>
          <Text>{asunto || "Sin asunto"}</Text>
        </div>
        <Paragraph style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>
          {mensaje}
        </Paragraph>
      </Card>
    </div>
  );
}
