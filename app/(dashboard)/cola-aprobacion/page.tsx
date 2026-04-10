"use client";

import { useCallback, useEffect, useState } from "react";
import { Typography, Button, Space, Tag, Alert, message } from "antd";
import { PlusCircleOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import type { CobranzaGestion } from "@/lib/types/cobranzas";
import ResumenCola from "@/components/cola/ResumenCola";
import TablaColaAprobacion from "@/components/cola/TablaColaAprobacion";

const { Title } = Typography;

export default function ColaAprobacionPage() {
  const [gestiones, setGestiones] = useState<CobranzaGestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [vistaEstado, setVistaEstado] = useState<string>("PENDIENTE");
  const [resumen, setResumen] = useState({
    pendientes: 0,
    aprobadas_hoy: 0,
    descartadas_hoy: 0,
    escaladas_hoy: 0,
  });

  const [messageApi, contextHolder] = message.useMessage();

  const fetchCola = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cobranzas/cola-aprobacion?estado=${vistaEstado}`);
      const data = await res.json();
      setGestiones(data.gestiones || []);
      setResumen({
        pendientes: data.pendientes || 0,
        aprobadas_hoy: data.aprobadas_hoy || 0,
        descartadas_hoy: data.descartadas_hoy || 0,
        escaladas_hoy: data.escaladas_hoy || 0,
      });
    } catch {
      setGestiones([]);
    } finally {
      setLoading(false);
    }
  }, [vistaEstado]);

  useEffect(() => {
    fetchCola();
  }, [fetchCola]);

  const handleGenerarCola = async () => {
    setGenerando(true);
    try {
      const res = await fetch("/api/cobranzas/generar-cola", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        messageApi.error(data.error || "Error generando cola");
        return;
      }

      messageApi.success(`${data.generadas} gestiones generadas`);
      fetchCola();
    } catch {
      messageApi.error("Error de conexión");
    } finally {
      setGenerando(false);
    }
  };

  const handleEnviarTodo = async () => {
    const aprobadas = gestiones.filter(
      (g) => g.estado === "APROBADO" || g.estado === "EDITADO"
    );
    if (aprobadas.length === 0) {
      messageApi.warning("No hay gestiones aprobadas para enviar");
      return;
    }
    setEnviando(true);
    let enviadas = 0;
    let fallidas = 0;
    for (const g of aprobadas) {
      try {
        const res = await fetch(`/api/cobranzas/gestiones/${g.id}/enviar`, { method: "POST" });
        if (res.ok) enviadas++;
        else fallidas++;
      } catch {
        fallidas++;
      }
    }
    messageApi.success(`${enviadas} enviadas${fallidas > 0 ? `, ${fallidas} fallidas` : ""}`);
    setEnviando(false);
    fetchCola();
  };

  return (
    <div>
      {contextHolder}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Cola de Aprobación
          </Title>
          <Space size={8} style={{ marginTop: 4 }}>
            {resumen.pendientes > 0 && (
              <Tag color="orange">{resumen.pendientes} pendientes</Tag>
            )}
          </Space>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchCola}
            loading={loading}
          >
            Actualizar
          </Button>
          {vistaEstado === "PENDIENTE" && (
            <Button
              type="primary"
              icon={<PlusCircleOutlined />}
              onClick={handleGenerarCola}
              loading={generando}
            >
              Generar Cola
            </Button>
          )}
          {(vistaEstado === "APROBADO" || vistaEstado === "EDITADO") && gestiones.length > 0 && (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleEnviarTodo}
              loading={enviando}
              style={{ background: "#52c41a", borderColor: "#52c41a" }}
            >
              Enviar Todo ({gestiones.length})
            </Button>
          )}
        </Space>
      </div>

      {/* Tabs de estado */}
      <Space style={{ marginBottom: 16 }}>
        {["PENDIENTE", "APROBADO", "ENVIADO", "DESCARTADO"].map((est) => (
          <Button
            key={est}
            type={vistaEstado === est ? "primary" : "default"}
            size="small"
            onClick={() => setVistaEstado(est)}
          >
            {est === "PENDIENTE" ? "Pendientes" : est === "APROBADO" ? "Aprobadas" : est === "ENVIADO" ? "Enviadas" : "Descartadas"}
          </Button>
        ))}
      </Space>

      {gestiones.length === 0 && !loading && vistaEstado === "PENDIENTE" && (
        <Alert
          message="Cola vacía"
          description='No hay gestiones pendientes. Haga clic en "Generar Cola" para crear mensajes de cobranza automáticamente.'
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Resumen */}
      <ResumenCola
        pendientes={resumen.pendientes}
        aprobadas_hoy={resumen.aprobadas_hoy}
        descartadas_hoy={resumen.descartadas_hoy}
        escaladas_hoy={resumen.escaladas_hoy}
      />

      {/* Tabla */}
      <TablaColaAprobacion
        gestiones={gestiones}
        loading={loading}
        onRefresh={fetchCola}
      />
    </div>
  );
}
