"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Table,
  Card,
  Row,
  Col,
  Statistic,
  Input,
  Button,
  Space,
  Tag,
  Drawer,
  Form,
  Select,
  message,
  Descriptions,
  Timeline,
  Divider,
  Modal,
  InputNumber,
  Tooltip,
  Popconfirm,
  DatePicker,
  Alert,
} from "antd";
import {
  ExclamationCircleOutlined,
  PlusOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

type EstadoDisputa = "ABIERTA" | "EN_REVISION" | "RESUELTA" | "ANULADA";

interface Disputa {
  id: number;
  codigo_cliente: string;
  nombre_cliente: string;
  ij_inum: number;
  motivo: string;
  monto_disputado: number | null;
  estado: EstadoDisputa;
  resolucion: string | null;
  resuelto_por: string | null;
  fecha_resolucion: string | null;
  registrado_por: string;
  created_at: string;
  updated_at: string;
}

interface DisputaDetalle extends Disputa {
  cliente: {
    IC_CODE: string;
    IC_NAME: string;
    IC_EMAIL: string;
    IC_PHONE: string;
  } | null;
  factura: {
    IJ_INUM: number;
    IJ_DATE: string;
    IJ_DUEDATE: string;
    IJ_TOT: number;
    IJ_TOTAPPL: number;
    saldo_pendiente: number;
    IJ_NCFFIX: string;
    IJ_NCFNUM: number;
  } | null;
  logs: Array<{
    usuario_id: string;
    accion: string;
    detalle: Record<string, unknown> | null;
    created_at: string;
  }>;
}

const ESTADO_CONFIG: Record<EstadoDisputa, { color: string; label: string; icon: React.ReactNode }> = {
  ABIERTA: { color: "red", label: "Abierta", icon: <ExclamationCircleOutlined /> },
  EN_REVISION: { color: "orange", label: "En revisión", icon: <ClockCircleOutlined /> },
  RESUELTA: { color: "green", label: "Resuelta", icon: <CheckCircleOutlined /> },
  ANULADA: { color: "default", label: "Anulada", icon: <CloseCircleOutlined /> },
};

const ACCION_LABEL: Record<string, string> = {
  DISPUTA_CREADA: "Disputa creada",
  DISPUTA_EDITADA: "Disputa editada",
  DISPUTA_EN_REVISION: "Puesta en revisión",
  DISPUTA_RESUELTA: "Disputa resuelta",
  DISPUTA_ANULADA: "Disputa anulada",
};

function fmt(n: number) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP", maximumFractionDigits: 2 }).format(n);
}

export default function DisputasPage() {
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [porEstado, setPorEstado] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<EstadoDisputa | "">("");
  const [busqueda, setBusqueda] = useState("");
  const [rango, setRango] = useState<[string, string] | null>(null);

  // Drawer detalle
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detalle, setDetalle] = useState<DisputaDetalle | null>(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  // Modal nueva disputa
  const [modalNuevaOpen, setModalNuevaOpen] = useState(false);
  const [formNueva] = Form.useForm();
  const [guardando, setGuardando] = useState(false);

  // Modal resolución
  const [modalResolucionOpen, setModalResolucionOpen] = useState(false);
  const [resolucionAccion, setResolucionAccion] = useState<"RESUELTA" | "ANULADA">("RESUELTA");
  const [formResolucion] = Form.useForm();
  const [ejecutando, setEjecutando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroEstado) params.set("estado", filtroEstado);
      if (busqueda) params.set("busqueda", busqueda);
      if (rango) { params.set("desde", rango[0]); params.set("hasta", rango[1]); }

      const res = await fetch(`/api/cobranzas/disputas?${params}`);
      const data = await res.json();
      setDisputas(data.disputas || []);
      setPorEstado(data.por_estado || {});
    } catch {
      message.error("Error cargando disputas");
    } finally {
      setLoading(false);
    }
  }, [filtroEstado, busqueda, rango]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirDetalle = async (id: number) => {
    setDrawerOpen(true);
    setDetalle(null);
    setLoadingDetalle(true);
    try {
      const res = await fetch(`/api/cobranzas/disputas/${id}`);
      const data = await res.json();
      setDetalle({ ...data.disputa, cliente: data.cliente, factura: data.factura, logs: data.logs });
    } catch {
      message.error("Error cargando detalle");
    } finally {
      setLoadingDetalle(false);
    }
  };

  const transicionar = async (id: number, estado: EstadoDisputa, extra?: Record<string, unknown>) => {
    setEjecutando(true);
    try {
      const res = await fetch(`/api/cobranzas/disputas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado, ...extra }),
      });
      if (!res.ok) {
        const err = await res.json();
        message.error(err.error || "Error actualizando");
        return false;
      }
      message.success(`Disputa ${ESTADO_CONFIG[estado].label.toLowerCase()}`);
      return true;
    } catch {
      message.error("Error de red");
      return false;
    } finally {
      setEjecutando(false);
    }
  };

  const handleEnRevision = async (disputa: Disputa) => {
    const ok = await transicionar(disputa.id, "EN_REVISION");
    if (ok) { cargar(); if (detalle?.id === disputa.id) abrirDetalle(disputa.id); }
  };

  const handleResolver = async () => {
    if (!detalle) return;
    try {
      const values = await formResolucion.validateFields();
      const ok = await transicionar(detalle.id, resolucionAccion, { resolucion: values.resolucion });
      if (ok) {
        setModalResolucionOpen(false);
        formResolucion.resetFields();
        cargar();
        abrirDetalle(detalle.id);
      }
    } catch {
      // validación falló
    }
  };

  const crearDisputa = async () => {
    try {
      const values = await formNueva.validateFields();
      setGuardando(true);
      const res = await fetch("/api/cobranzas/disputas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const err = await res.json();
        message.error(err.error || "Error creando");
        return;
      }
      message.success("Disputa registrada");
      setModalNuevaOpen(false);
      formNueva.resetFields();
      cargar();
    } catch {
      // validación falló
    } finally {
      setGuardando(false);
    }
  };

  const columns: ColumnsType<Disputa> = [
    {
      title: "Cliente",
      dataIndex: "nombre_cliente",
      render: (nombre: string, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{nombre}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.codigo_cliente}</Text>
        </Space>
      ),
    },
    {
      title: "Factura",
      dataIndex: "ij_inum",
      width: 100,
      render: (n: number) => <Text code>{n}</Text>,
    },
    {
      title: "Motivo",
      dataIndex: "motivo",
      ellipsis: true,
      render: (m: string) => (
        <Tooltip title={m}>
          <Text>{m.length > 80 ? m.substring(0, 80) + "…" : m}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Monto",
      dataIndex: "monto_disputado",
      width: 140,
      align: "right",
      render: (m: number | null) => m != null ? <Text>{fmt(m)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: "Estado",
      dataIndex: "estado",
      width: 130,
      render: (e: EstadoDisputa) => {
        const cfg = ESTADO_CONFIG[e];
        return <Tag icon={cfg.icon} color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: "Registrada",
      dataIndex: "created_at",
      width: 130,
      render: (d: string) => dayjs(d).format("DD/MM/YY HH:mm"),
    },
    {
      title: "",
      width: 80,
      align: "center",
      render: (_: unknown, r) => (
        <Button icon={<EyeOutlined />} size="small" onClick={() => abrirDetalle(r.id)}>
          Ver
        </Button>
      ),
    },
  ];

  const contarEstado = (e: string) => Number(porEstado[e] || 0);

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>
            <ExclamationCircleOutlined /> Disputas
          </Title>
          <Text type="secondary">
            Facturas en desacuerdo — excluidas de la cola de cobranza mientras estén activas (CP-03).
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalNuevaOpen(true)}>
          Nueva disputa
        </Button>
      </div>

      {/* Cards resumen */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {(["ABIERTA", "EN_REVISION", "RESUELTA", "ANULADA"] as EstadoDisputa[]).map((e) => {
          const cfg = ESTADO_CONFIG[e];
          return (
            <Col span={6} key={e}>
              <Card
                hoverable
                style={{ cursor: "pointer", borderColor: filtroEstado === e ? "#1677ff" : undefined }}
                onClick={() => setFiltroEstado(filtroEstado === e ? "" : e)}
              >
                <Statistic
                  title={<Tag icon={cfg.icon} color={cfg.color}>{cfg.label}</Tag>}
                  value={contarEstado(e)}
                  suffix="disputas"
                />
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* Filtros */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Buscar por código cliente"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            placeholder="Estado"
            value={filtroEstado || undefined}
            onChange={(v) => setFiltroEstado(v || "")}
            allowClear
            style={{ width: 160 }}
            options={[
              { value: "ABIERTA", label: "Abierta" },
              { value: "EN_REVISION", label: "En revisión" },
              { value: "RESUELTA", label: "Resuelta" },
              { value: "ANULADA", label: "Anulada" },
            ]}
          />
          <RangePicker
            format="DD/MM/YYYY"
            onChange={(_, strs) =>
              setRango(strs[0] && strs[1] ? [strs[0].split("/").reverse().join("-"), strs[1].split("/").reverse().join("-")] : null)
            }
            placeholder={["Desde", "Hasta"]}
          />
          <Button icon={<ReloadOutlined />} onClick={cargar}>
            Actualizar
          </Button>
        </Space>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={disputas}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          size="middle"
        />
      </Card>

      {/* Drawer detalle */}
      <Drawer
        title={
          detalle ? (
            <Space>
              <span>Disputa #{detalle.id}</span>
              <Tag icon={ESTADO_CONFIG[detalle.estado]?.icon} color={ESTADO_CONFIG[detalle.estado]?.color}>
                {ESTADO_CONFIG[detalle.estado]?.label}
              </Tag>
            </Space>
          ) : "Cargando..."
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={640}
        loading={loadingDetalle}
        footer={
          detalle && (
            <DrawerFooter
              disputa={detalle}
              ejecutando={ejecutando}
              onEnRevision={() => handleEnRevision(detalle)}
              onAbrirResolver={(accion) => {
                setResolucionAccion(accion);
                setModalResolucionOpen(true);
              }}
            />
          )
        }
      >
        {detalle && <DetalleContent detalle={detalle} />}
      </Drawer>

      {/* Modal: resolución / anulación */}
      <Modal
        title={resolucionAccion === "RESUELTA" ? "Resolver disputa" : "Anular disputa"}
        open={modalResolucionOpen}
        onCancel={() => { setModalResolucionOpen(false); formResolucion.resetFields(); }}
        onOk={handleResolver}
        okText={resolucionAccion === "RESUELTA" ? "Marcar como resuelta" : "Anular disputa"}
        okButtonProps={{ danger: resolucionAccion === "ANULADA", loading: ejecutando }}
        width={480}
      >
        <Alert
          type={resolucionAccion === "RESUELTA" ? "success" : "warning"}
          message={
            resolucionAccion === "RESUELTA"
              ? "La factura volverá a la cartera activa."
              : "La disputa quedará cerrada sin acción."
          }
          style={{ marginBottom: 16 }}
          showIcon
        />
        <Form form={formResolucion} layout="vertical">
          <Form.Item
            name="resolucion"
            label={resolucionAccion === "RESUELTA" ? "Resolución (obligatoria)" : "Motivo de anulación (opcional)"}
            rules={resolucionAccion === "RESUELTA" ? [{ required: true, min: 5 }] : []}
          >
            <TextArea
              rows={4}
              placeholder={
                resolucionAccion === "RESUELTA"
                  ? "Ej. Cliente presentó NCF correcto, monto verificado con contabilidad."
                  : "Ej. Disputa registrada por error."
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: nueva disputa */}
      <Modal
        title="Registrar nueva disputa"
        open={modalNuevaOpen}
        onCancel={() => { setModalNuevaOpen(false); formNueva.resetFields(); }}
        onOk={crearDisputa}
        okText="Registrar disputa"
        okButtonProps={{ loading: guardando }}
        width={520}
      >
        <Alert
          type="info"
          message="La factura quedará excluida de la cola de cobranza mientras la disputa esté abierta (CP-03)."
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={formNueva} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="codigo_cliente" label="Código cliente" rules={[{ required: true }]}>
                <Input placeholder="Ej. 0000274" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="ij_inum" label="Nº interno factura" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} placeholder="Ej. 12345" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="monto_disputado" label="Monto disputado (opcional)">
            <InputNumber style={{ width: "100%" }} min={0} placeholder="0.00" precision={2} />
          </Form.Item>
          <Form.Item name="motivo" label="Motivo de la disputa" rules={[{ required: true, min: 5 }]}>
            <TextArea
              rows={4}
              placeholder="Ej. El cliente indica que el monto no corresponde al pedido entregado. NCF no coincide."
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ─── Sub-componente: contenido del drawer ───────────────────────────────────

function DetalleContent({ detalle }: { detalle: DisputaDetalle }) {
  const { cliente, factura, logs } = detalle;

  return (
    <>
      <Descriptions title="Cliente" bordered size="small" column={1} style={{ marginBottom: 20 }}>
        <Descriptions.Item label="Código">{detalle.codigo_cliente}</Descriptions.Item>
        <Descriptions.Item label="Nombre">
          {cliente ? cliente.IC_NAME : <Text type="secondary">No disponible</Text>}
        </Descriptions.Item>
        {cliente?.IC_EMAIL && (
          <Descriptions.Item label="Email">{cliente.IC_EMAIL}</Descriptions.Item>
        )}
        {cliente?.IC_PHONE && (
          <Descriptions.Item label="Teléfono">{cliente.IC_PHONE}</Descriptions.Item>
        )}
      </Descriptions>

      <Descriptions title="Factura" bordered size="small" column={2} style={{ marginBottom: 20 }}>
        <Descriptions.Item label="Nº interno">
          <Text code>{detalle.ij_inum}</Text>
        </Descriptions.Item>
        {factura && (
          <>
            <Descriptions.Item label="NCF">
              {factura.IJ_NCFFIX}{String(factura.IJ_NCFNUM).padStart(8, "0")}
            </Descriptions.Item>
            <Descriptions.Item label="Emisión">
              {dayjs(factura.IJ_DATE).format("DD/MM/YYYY")}
            </Descriptions.Item>
            <Descriptions.Item label="Vencimiento">
              {dayjs(factura.IJ_DUEDATE).format("DD/MM/YYYY")}
            </Descriptions.Item>
            <Descriptions.Item label="Total">
              {new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(factura.IJ_TOT)}
            </Descriptions.Item>
            <Descriptions.Item label="Saldo pendiente">
              <Text type={factura.saldo_pendiente > 0 ? "danger" : "success"} strong>
                {new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(factura.saldo_pendiente)}
              </Text>
            </Descriptions.Item>
          </>
        )}
      </Descriptions>

      <Descriptions title="Disputa" bordered size="small" column={1} style={{ marginBottom: 20 }}>
        <Descriptions.Item label="Registrada por">{detalle.registrado_por}</Descriptions.Item>
        <Descriptions.Item label="Fecha">{dayjs(detalle.created_at).format("DD/MM/YYYY HH:mm")}</Descriptions.Item>
        {detalle.monto_disputado != null && (
          <Descriptions.Item label="Monto disputado">
            <Text strong>
              {new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(detalle.monto_disputado)}
            </Text>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Motivo">
          <Text style={{ whiteSpace: "pre-wrap" }}>{detalle.motivo}</Text>
        </Descriptions.Item>
        {detalle.resolucion && (
          <Descriptions.Item label="Resolución">
            <Text style={{ whiteSpace: "pre-wrap" }}>{detalle.resolucion}</Text>
          </Descriptions.Item>
        )}
        {detalle.resuelto_por && (
          <Descriptions.Item label="Resuelto por">
            {detalle.resuelto_por}
            {detalle.fecha_resolucion && ` — ${dayjs(detalle.fecha_resolucion).format("DD/MM/YYYY HH:mm")}`}
          </Descriptions.Item>
        )}
      </Descriptions>

      {logs.length > 0 && (
        <>
          <Divider>Historial de acciones</Divider>
          <Timeline
            items={logs.map((log) => ({
              color:
                log.accion.includes("RESUELTA") ? "green"
                : log.accion.includes("ANULADA") ? "gray"
                : log.accion.includes("EN_REVISION") ? "orange"
                : "blue",
              children: (
                <Space direction="vertical" size={0}>
                  <Text strong style={{ fontSize: 13 }}>
                    {ACCION_LABEL[log.accion] || log.accion}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {log.usuario_id} · {dayjs(log.created_at).format("DD/MM/YY HH:mm")}
                  </Text>
                </Space>
              ),
            }))}
          />
        </>
      )}
    </>
  );
}

// ─── Sub-componente: footer del drawer con acciones ─────────────────────────

interface DrawerFooterProps {
  disputa: DisputaDetalle;
  ejecutando: boolean;
  onEnRevision: () => void;
  onAbrirResolver: (accion: "RESUELTA" | "ANULADA") => void;
}

function DrawerFooter({ disputa, ejecutando, onEnRevision, onAbrirResolver }: DrawerFooterProps) {
  const { estado } = disputa;

  if (estado === "RESUELTA" || estado === "ANULADA") {
    return (
      <Text type="secondary">
        <CheckCircleOutlined /> Esta disputa está cerrada y no puede modificarse.
      </Text>
    );
  }

  return (
    <Space>
      {estado === "ABIERTA" && (
        <Button
          type="primary"
          icon={<ClockCircleOutlined />}
          loading={ejecutando}
          onClick={onEnRevision}
        >
          Poner en revisión
        </Button>
      )}
      {(estado === "ABIERTA" || estado === "EN_REVISION") && (
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          onClick={() => onAbrirResolver("RESUELTA")}
          disabled={ejecutando}
        >
          Resolver
        </Button>
      )}
      <Popconfirm
        title="¿Anular esta disputa?"
        description="La factura volverá a la cartera activa."
        onConfirm={() => onAbrirResolver("ANULADA")}
        okText="Anular"
        okButtonProps={{ danger: true }}
        cancelText="Cancelar"
      >
        <Button danger icon={<CloseCircleOutlined />} disabled={ejecutando}>
          Anular
        </Button>
      </Popconfirm>
    </Space>
  );
}
