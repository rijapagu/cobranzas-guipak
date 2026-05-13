"use client";

import { useState } from "react";
import { List, Badge, Typography, Tag, Input } from "antd";
import { MessageOutlined, SearchOutlined } from "@ant-design/icons";
import { formatFecha } from "@/lib/utils/formato";

const { Text } = Typography;

interface ConversacionResumen {
  codigo_cliente: string;
  nombre_cliente?: string;
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
  const [busqueda, setBusqueda] = useState("");

  const filtradas = busqueda.trim()
    ? conversaciones.filter((c) => {
        const term = busqueda.toLowerCase();
        return (
          c.codigo_cliente.toLowerCase().includes(term) ||
          (c.nombre_cliente || "").toLowerCase().includes(term)
        );
      })
    : conversaciones;

  return (
    <div>
      <Input
        prefix={<SearchOutlined />}
        placeholder="Buscar por nombre o código..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        allowClear
        style={{ marginBottom: 8 }}
        size="small"
      />
      <List
        loading={loading}
        dataSource={filtradas}
        locale={{ emptyText: busqueda ? "Sin resultados" : "Sin conversaciones" }}
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13 }}>{item.codigo_cliente}</Text>
                    {item.nombre_cliente && item.nombre_cliente !== item.codigo_cliente && (
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }} ellipsis>
                        {item.nombre_cliente}
                      </Text>
                    )}
                  </div>
                  <Text type="secondary" style={{ fontSize: 10, flexShrink: 0, marginLeft: 4 }}>
                    {formatFecha(item.ultimo_mensaje)}
                  </Text>
                </div>
              }
              description={
                <div>
                  <Text type="secondary" ellipsis style={{ fontSize: 12, maxWidth: 250, display: "block" }}>
                    {item.ultimo_contenido?.substring(0, 80)}
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
    </div>
  );
}
