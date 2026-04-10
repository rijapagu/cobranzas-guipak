"use client";

import { useCallback, useEffect, useState } from "react";
import { Typography, Row, Col, Card, Empty } from "antd";
import ListaConversaciones from "@/components/conversaciones/ListaConversaciones";
import ChatView from "@/components/conversaciones/ChatView";

const { Title, Text } = Typography;

interface ConversacionResumen {
  codigo_cliente: string;
  total_mensajes: number;
  recibidos_sin_responder: number;
  ultimo_mensaje: string;
  ultimo_contenido: string;
  ultimo_canal: string;
}

interface Mensaje {
  id: number;
  direccion: 'ENVIADO' | 'RECIBIDO';
  contenido: string;
  canal: string;
  estado: string;
  generado_por_ia: boolean;
  created_at: string;
}

export default function ConversacionesPage() {
  const [conversaciones, setConversaciones] = useState<ConversacionResumen[]>([]);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [selectedCliente, setSelectedCliente] = useState<string>("");

  const fetchConversaciones = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cobranzas/conversaciones");
      const data = await res.json();
      setConversaciones(data.conversaciones || []);
    } catch {
      setConversaciones([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMensajes = async (codigoCliente: string) => {
    setSelectedCliente(codigoCliente);
    setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/cobranzas/conversaciones?cliente=${codigoCliente}`);
      const data = await res.json();
      setMensajes(data.mensajes || []);
    } catch {
      setMensajes([]);
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    fetchConversaciones();
  }, [fetchConversaciones]);

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        Conversaciones
      </Title>

      {conversaciones.length === 0 && !loading ? (
        <Empty description="Sin conversaciones aún. Los mensajes enviados y respuestas de clientes aparecerán aquí." />
      ) : (
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Card title="Clientes" size="small" style={{ height: "calc(100vh - 220px)", overflow: "auto" }}>
              <ListaConversaciones
                conversaciones={conversaciones}
                loading={loading}
                onSelect={fetchMensajes}
                selectedCliente={selectedCliente}
              />
            </Card>
          </Col>
          <Col xs={24} md={16}>
            <Card
              title={selectedCliente ? `Chat — ${selectedCliente}` : "Seleccione un cliente"}
              size="small"
              style={{ height: "calc(100vh - 220px)", overflow: "auto" }}
              loading={loadingMsgs}
            >
              {selectedCliente ? (
                <ChatView mensajes={mensajes} />
              ) : (
                <Text type="secondary">Seleccione un cliente de la lista para ver la conversación</Text>
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
