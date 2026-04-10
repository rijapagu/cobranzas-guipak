"use client";

import { useCallback, useEffect, useState } from "react";
import { Typography, Button, Space, Tag, Alert, message } from "antd";
import { PlusCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { CobranzaGestion } from "@/lib/types/cobranzas";
import ResumenCola from "@/components/cola/ResumenCola";
import TablaColaAprobacion from "@/components/cola/TablaColaAprobacion";

const { Title } = Typography;

export default function ColaAprobacionPage() {
  const [gestiones, setGestiones] = useState<CobranzaGestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);
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
      const res = await fetch("/api/cobranzas/cola-aprobacion");
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
  }, []);

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
      messageApi.error("Error de conexi\u00f3n");
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div>
      {contextHolder}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Cola de Aprobaci\u00f3n
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
          <Button
            type="primary"
            icon={<PlusCircleOutlined />}
            onClick={handleGenerarCola}
            loading={generando}
          >
            Generar Cola
          </Button>
        </Space>
      </div>

      {gestiones.length === 0 && !loading && (
        <Alert
          message="Cola vac\u00eda"
          description='No hay gestiones pendientes. Haga clic en "Generar Cola" para crear mensajes de cobranza autom\u00e1ticamente.'
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
