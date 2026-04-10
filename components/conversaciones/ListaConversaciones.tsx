"use client";

import { List, Badge, Typography, Tag } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import { formatFecha } from "@/lib/utils/formato";

const { Text } = Typography;

interface ConversacionResumen {
  codigo_cliente: string;
  total_mensajes: number;
  recibidos_sin_responder: number;
  ultimo_mensaje: string;
  ultimo_contenido: string;
  ultimo_canal: string;
}

interface Props {
  conversaciones: ConversacionResumen[];
  loading: boolean;
  onSelect: (codigoCliente: string) => void;
  selectedCliente?: string;
}

export default function ListaConversaciones({ conversaciones, loading, onSelect, selectedCliente }: Props) {
  return (
    <List
      loading={loading}
      dataSource={conversaciones}
      renderItem={(item) => (
        <List.Item
          onClick={() => onSelect(item.codigo_cliente)}
          style={{
            cursor: "pointer",
            padding: "12px 16px",
            background: selectedCliente === item.codigo_cliente ? "#e6f4ff" : "transparent",
            borderLeft: selectedCliente === item.codigo_cliente ? "3px solid #1890ff" : "3px solid transparent",
          }}
        >
          <List.Item.Meta
            avatar={
              <Badge count={item.recibidos_sin_responder} size="small">
                <MessageOutlined style={{ fontSize: 20, color: "#1890ff" }} />
              </Badge>
            }
            title={
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text strong>{item.codigo_cliente}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {formatFecha(item.ultimo_mensaje)}
                </Text>
              </div>
            }
            description={
              <div>
                <Text type="secondary" ellipsis style={{ fontSize: 12, maxWidth: 200, display: "block" }}>
                  {item.ultimo_contenido?.substring(0, 60)}...
                </Text>
                <Tag color={item.ultimo_canal === "WHATSAPP" ? "green" : "blue"} style={{ fontSize: 10, marginTop: 4 }}>
                  {item.ultimo_canal}
                </Tag>
                <Tag style={{ fontSize: 10, marginTop: 4 }}>{item.total_mensajes} msgs</Tag>
              </div>
            }
          />
        </List.Item>
      )}
    />
  );
}
