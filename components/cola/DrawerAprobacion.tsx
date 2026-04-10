"use client";

import { useState } from "react";
import {
  Drawer, Descriptions, Divider, Button, Space, Input, Modal,
  InputNumber, Typography, message, Tabs,
} from "antd";
import {
  CheckOutlined, EditOutlined, CloseOutlined,
  ExclamationCircleOutlined, PauseCircleOutlined, SendOutlined,
} from "@ant-design/icons";
import type { CobranzaGestion } from "@/lib/types/cobranzas";
import { formatMonto, formatFecha, diasVencidoTexto, colorSegmento } from "@/lib/utils/formato";
import SegmentoTag from "@/components/cartera/SegmentoTag";
import PreviewWhatsApp from "./PreviewWhatsApp";
import PreviewEmail from "./PreviewEmail";

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  gestion: CobranzaGestion | null;
  open: boolean;
  onClose: () => void;
  onAccionCompletada: () => void;
}

export default function DrawerAprobacion({ gestion, open, onClose, onAccionCompletada }: Props) {
  const [editando, setEditando] = useState(false);
  const [msgWa, setMsgWa] = useState("");
  const [msgEmail, setMsgEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [motivoModal, setMotivoModal] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pausaModal, setPausaModal] = useState(false);
  const [diasPausa, setDiasPausa] = useState<number>(7);

  const [messageApi, contextHolder] = message.useMessage();

  if (!gestion) return null;

  const handleAprobar = async () => {
    setLoading(true);
    try {
      const body = editando
        ? { mensaje_editado_wa: msgWa, mensaje_editado_email: msgEmail }
        : {};

      const res = await fetch(`/api/cobranzas/gestiones/${gestion.id}/aprobar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        messageApi.error(data.error || "Error aprobando");
        return;
      }

      messageApi.success(editando ? "Editada y aprobada" : "Aprobada");
      setEditando(false);
      onClose();
      onAccionCompletada();
    } catch {
      messageApi.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleDescartar = async () => {
    if (!motivo.trim()) {
      messageApi.warning("Ingrese un motivo");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/cobranzas/gestiones/${gestion.id}/descartar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });

      if (!res.ok) {
        const data = await res.json();
        messageApi.error(data.error || "Error descartando");
        return;
      }

      messageApi.success("Descartada");
      setMotivoModal(false);
      setMotivo("");
      onClose();
      onAccionCompletada();
    } catch {
      messageApi.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleEscalar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cobranzas/gestiones/${gestion.id}/escalar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json();
        messageApi.error(data.error || "Error escalando");
        return;
      }

      messageApi.success("Escalada a gestión manual");
      onClose();
      onAccionCompletada();
    } catch {
      messageApi.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const iniciarEdicion = () => {
    setMsgWa(gestion.mensaje_propuesto_wa || "");
    setMsgEmail(gestion.mensaje_propuesto_email || "");
    setEditando(true);
  };

  const handleEnviar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cobranzas/gestiones/${gestion.id}/enviar`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        messageApi.error(data.error || "Error enviando");
        return;
      }
      messageApi.success("Mensaje enviado");
      onClose();
      onAccionCompletada();
    } catch {
      messageApi.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const esAprobado = gestion.estado === "APROBADO" || gestion.estado === "EDITADO";
  const esPendiente = gestion.estado === "PENDIENTE";

  return (
    <>
      {contextHolder}
      <Drawer
        title={
          <Space>
            <span>Gestión #{gestion.id}</span>
            <SegmentoTag segmento={gestion.segmento_riesgo} />
          </Space>
        }
        open={open}
        onClose={() => { setEditando(false); onClose(); }}
        width={800}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Space>
              <Button
                icon={<PauseCircleOutlined />}
                onClick={() => setPausaModal(true)}
              >
                Pausar Cliente
              </Button>
              <Button
                icon={<ExclamationCircleOutlined />}
                onClick={handleEscalar}
                loading={loading}
              >
                Escalar
              </Button>
            </Space>
            <Space>
              <Button
                danger
                icon={<CloseOutlined />}
                onClick={() => setMotivoModal(true)}
              >
                Descartar
              </Button>
              {esAprobado ? (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleEnviar}
                  loading={loading}
                  style={{ background: "#52c41a", borderColor: "#52c41a" }}
                >
                  Enviar Ahora
                </Button>
              ) : !editando ? (
                <>
                  <Button icon={<EditOutlined />} onClick={iniciarEdicion}>
                    Editar
                  </Button>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={handleAprobar}
                    loading={loading}
                  >
                    Aprobar
                  </Button>
                </>
              ) : (
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={handleAprobar}
                  loading={loading}
                >
                  Guardar y Aprobar
                </Button>
              )}
            </Space>
          </div>
        }
      >
        {/* Info de factura */}
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="Cliente" span={2}>
            <Text strong>{gestion.nombre_cliente || gestion.codigo_cliente}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Factura">#{gestion.ij_inum}</Descriptions.Item>
          <Descriptions.Item label="Canal">{gestion.canal}</Descriptions.Item>
          <Descriptions.Item label="Saldo">
            <Text type="danger" strong>
              {formatMonto(gestion.saldo_pendiente, gestion.moneda)}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Días Vencido">
            <Text style={{ color: colorSegmento(gestion.segmento_riesgo) }}>
              {diasVencidoTexto(gestion.dias_vencido)}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Vencimiento">
            {formatFecha(gestion.fecha_vencimiento)}
          </Descriptions.Item>
          <Descriptions.Item label="Total Factura">
            {formatMonto(gestion.total_factura, gestion.moneda)}
          </Descriptions.Item>
        </Descriptions>

        <Divider>Mensajes Propuestos</Divider>

        {editando ? (
          <Tabs
            items={[
              {
                key: "wa",
                label: "WhatsApp",
                children: (
                  <div>
                    <TextArea
                      value={msgWa}
                      onChange={(e) => setMsgWa(e.target.value)}
                      rows={6}
                      maxLength={500}
                      showCount
                    />
                  </div>
                ),
              },
              {
                key: "email",
                label: "Email",
                children: (
                  <div>
                    <TextArea
                      value={msgEmail}
                      onChange={(e) => setMsgEmail(e.target.value)}
                      rows={10}
                      showCount
                    />
                  </div>
                ),
              },
            ]}
          />
        ) : (
          <Tabs
            items={[
              {
                key: "wa",
                label: "WhatsApp",
                children: <PreviewWhatsApp mensaje={gestion.mensaje_propuesto_wa} />,
              },
              {
                key: "email",
                label: "Email",
                children: (
                  <PreviewEmail
                    asunto={gestion.asunto_email}
                    mensaje={gestion.mensaje_propuesto_email}
                  />
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* Modal descartar */}
      <Modal
        title="Descartar gestión"
        open={motivoModal}
        onOk={handleDescartar}
        onCancel={() => { setMotivoModal(false); setMotivo(""); }}
        confirmLoading={loading}
        okText="Descartar"
        okButtonProps={{ danger: true }}
      >
        <p>Indique el motivo por el cual se descarta esta gestión:</p>
        <TextArea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Ej: Cliente ya pagó, factura incorrecta, etc."
        />
      </Modal>

      {/* Modal pausar */}
      <Modal
        title="Pausar cliente"
        open={pausaModal}
        onOk={() => {
          messageApi.info(`Pausa de ${diasPausa} días (funcionalidad completa en Fase 6)`);
          setPausaModal(false);
        }}
        onCancel={() => setPausaModal(false)}
        okText="Pausar"
      >
        <p>No gestionar este cliente por:</p>
        <InputNumber
          value={diasPausa}
          onChange={(v) => setDiasPausa(v || 7)}
          min={1}
          max={90}
          addonAfter="días"
        />
      </Modal>
    </>
  );
}
