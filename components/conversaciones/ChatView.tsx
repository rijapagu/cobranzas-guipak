"use client";

import { Typography } from "antd";
import { formatFecha } from "@/lib/utils/formato";

const { Text } = Typography;

interface Mensaje {
  id: number;
  direccion: 'ENVIADO' | 'RECIBIDO';
  contenido: string;
  canal: string;
  estado: string;
  generado_por_ia: boolean;
  created_at: string;
}

interface Props {
  mensajes: Mensaje[];
}

export default function ChatView({ mensajes }: Props) {
  if (mensajes.length === 0) {
    return <Text type="secondary">Sin mensajes</Text>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
      {mensajes.map((m) => (
        <div
          key={m.id}
          style={{
            display: "flex",
            justifyContent: m.direccion === "ENVIADO" ? "flex-end" : "flex-start",
          }}
        >
          <div
            style={{
              maxWidth: "75%",
              padding: "8px 12px",
              borderRadius: m.direccion === "ENVIADO" ? "12px 12px 0 12px" : "12px 12px 12px 0",
              background: m.direccion === "ENVIADO" ? "#dcf8c6" : "#f0f0f0",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <div style={{ whiteSpace: "pre-wrap" }}>{m.contenido}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
              {m.generado_por_ia && (
                <Text type="secondary" style={{ fontSize: 10 }}>IA</Text>
              )}
              <Text type="secondary" style={{ fontSize: 10 }}>
                {formatFecha(m.created_at)}
              </Text>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
