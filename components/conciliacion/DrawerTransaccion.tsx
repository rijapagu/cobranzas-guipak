"use client";

import { useState } from "react";
import { Drawer, Descriptions, Button, Space, Typography, Divider, message } from "antd";
import { CheckOutlined, UserAddOutlined } from "@ant-design/icons";
import type { ConciliacionEntry, ClienteOption } from "@/lib/types/conciliacion";
import { formatMonto, formatFecha } from "@/lib/utils/formato";
import SelectorCliente from "./SelectorCliente";

const { Text, Title } = Typography;

const estadoColor: Record<string, string> = {
  CONCILIADO: "#52c41a",
  POR_APLICAR: "#fa8c16",
  DESCONOCIDO: "#f5222d",
};

const estadoLabel: Record<string, string> = {
  CONCILIADO: "Conciliado",
  POR_APLICAR: "Por Aplicar",
  DESCONOCIDO: "Desconocido",
};

interface Props {
  entrada: ConciliacionEntry | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  clientes: ClienteOption[];
}

export default function DrawerTransaccion({ entrada, open, onClose, onRefresh, clientes }: Props) {
  const [clienteSel, setClienteSel] = useState<{ codigo: string; nombre: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  if (!entrada) return null;

  const handleAprobar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conciliacion/${entrada.id}/aprobar`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        messageApi.error(data.error);
        return;
      }
      messageApi.success("Aprobada");
      onClose();
      onRefresh();
    } catch {
      messageApi.error("Error");
    } finally {
      setLoading(false);
    }
  };

  const handleAsignar = async () => {
    if (!clienteSel) {
      messageApi.warning("Seleccione un cliente");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/conciliacion/${entrada.id}/asignar-cliente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clienteSel),
      });
      if (!res.ok) {
        const data = await res.json();
        messageApi.error(data.error);
        return;
      }
      messageApi.success(`Cliente asignado: ${clienteSel.nombre}`);
      setClienteSel(null);
      onClose();
      onRefresh();
    } catch {
      messageApi.error("Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Drawer
        title={
          <Space>
            <span>Transacci\u00f3n #{entrada.id}</span>
            <span style={{
              color: estadoColor[entrada.estado],
              fontWeight: 600,
              fontSize: 13,
              border: `1px solid ${estadoColor[entrada.estado]}`,
              borderRadius: 4,
              padding: "2px 8px",
            }}>
              {estadoLabel[entrada.estado]}
            </span>
          </Space>
        }
        open={open}
        onClose={onClose}
        width={600}
      >
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="Fecha">
            {formatFecha(entrada.fecha_transaccion)}
          </Descriptions.Item>
          <Descriptions.Item label="Banco">{entrada.banco}</Descriptions.Item>
          <Descriptions.Item label="Monto" span={2}>
            <Title level={4} style={{ margin: 0, color: "#1890ff" }}>
              {formatMonto(entrada.monto, entrada.moneda)}
            </Title>
          </Descriptions.Item>
          <Descriptions.Item label="Descripci\u00f3n" span={2}>
            {entrada.descripcion || <Text type="secondary">Sin descripci\u00f3n</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Referencia">
            {entrada.referencia || "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Cuenta Origen">
            {entrada.cuenta_origen || "-"}
          </Descriptions.Item>
          {entrada.codigo_cliente && (
            <Descriptions.Item label="Cliente" span={2}>
              <Text strong>{entrada.codigo_cliente}</Text>
              {entrada.nombre_cliente && ` — ${entrada.nombre_cliente}`}
            </Descriptions.Item>
          )}
          {entrada.ir_recnum && (
            <Descriptions.Item label="Recibo Softec" span={2}>
              <Text code>#{entrada.ir_recnum}</Text>
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Archivo">{entrada.archivo_origen}</Descriptions.Item>
          <Descriptions.Item label="Cargado por">{entrada.cargado_por}</Descriptions.Item>
        </Descriptions>

        {/* Acciones según estado */}
        {entrada.estado === "DESCONOCIDO" && (
          <>
            <Divider>Asignar Cliente</Divider>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Text>Seleccione el cliente que realiz\u00f3 esta transferencia:</Text>
              <SelectorCliente
                clientes={clientes}
                value={clienteSel?.codigo}
                onChange={(codigo, nombre) => setClienteSel({ codigo, nombre: nombre })}
              />
              <Button
                type="primary"
                icon={<UserAddOutlined />}
                onClick={handleAsignar}
                loading={loading}
                disabled={!clienteSel}
                block
              >
                Asignar y Aprender
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                El sistema recordar\u00e1 esta cuenta para futuras conciliaciones.
              </Text>
            </Space>
          </>
        )}

        {entrada.estado === "POR_APLICAR" && (
          <>
            <Divider>Acci\u00f3n</Divider>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={handleAprobar}
              loading={loading}
              block
              size="large"
            >
              Aprobar — Notificar para registro en Softec
            </Button>
          </>
        )}

        {entrada.estado === "CONCILIADO" && (
          <>
            <Divider />
            <Text type="success">
              Esta transacci\u00f3n ya est\u00e1 conciliada con Softec.
            </Text>
          </>
        )}
      </Drawer>
    </>
  );
}
