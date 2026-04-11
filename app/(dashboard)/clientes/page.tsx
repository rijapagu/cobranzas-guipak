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
  Switch,
  Modal,
  message,
  Segmented,
  Tooltip,
} from "antd";
import {
  UserOutlined,
  SearchOutlined,
  MailOutlined,
  PhoneOutlined,
  StopOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  EditOutlined,
  ReloadOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Title, Text } = Typography;

interface ClienteEnriquecido {
  codigo_cliente: string;
  nombre_cliente: string;
  rnc: string;
  email_softec: string | null;
  telefono_softec: string | null;
  telefono2_softec: string | null;
  contacto_cobros_softec: string | null;
  vendedor: string;
  email_enriq: string | null;
  whatsapp_enriq: string | null;
  contacto_cobros_enriq: string | null;
  canal_preferido: string | null;
  no_contactar: boolean;
  pausa_hasta: string | null;
  notas_cobros: string | null;
  tiene_email: boolean;
  tiene_whatsapp: boolean;
  total_facturas_pendientes: number;
  saldo_total: number;
}

interface EstadisticasClientes {
  totalClientes: number;
  sinEmail: number;
  sinWhatsapp: number;
  sinContacto: number;
}

function formatMonto(monto: number): string {
  return `RD$${monto.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<ClienteEnriquecido[]>([]);
  const [stats, setStats] = useState<EstadisticasClientes>({
    totalClientes: 0, sinEmail: 0, sinWhatsapp: 0, sinContacto: 0,
  });
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<string>("todos");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCliente, setSelectedCliente] = useState<ClienteEnriquecido | null>(null);
  const [saving, setSaving] = useState(false);
  const [generandoToken, setGenerandoToken] = useState(false);
  const [form] = Form.useForm();

  const fetchClientes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busqueda) params.set("busqueda", busqueda);
      if (filtro !== "todos") params.set("filtro", filtro);

      const res = await fetch(`/api/cobranzas/clientes?${params}`);
      const data = await res.json();
      setClientes(data.clientes || []);
      setStats(data.estadisticas || { totalClientes: 0, sinEmail: 0, sinWhatsapp: 0, sinContacto: 0 });
    } catch {
      message.error("Error cargando clientes");
    } finally {
      setLoading(false);
    }
  }, [busqueda, filtro]);

  useEffect(() => {
    fetchClientes();
  }, [fetchClientes]);

  const openEditar = (cliente: ClienteEnriquecido) => {
    setSelectedCliente(cliente);
    form.setFieldsValue({
      email: cliente.email_enriq || "",
      whatsapp: cliente.whatsapp_enriq || "",
      contacto_cobros: cliente.contacto_cobros_enriq || "",
      canal_preferido: cliente.canal_preferido || "WHATSAPP",
      no_contactar: cliente.no_contactar,
      notas_cobros: cliente.notas_cobros || "",
    });
    setDrawerOpen(true);
  };

  const handleGuardar = async (values: Record<string, unknown>) => {
    if (!selectedCliente) return;
    setSaving(true);
    try {
      const res = await fetch("/api/cobranzas/clientes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo_cliente: selectedCliente.codigo_cliente,
          ...values,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success("Datos actualizados");
        setDrawerOpen(false);
        fetchClientes();
      } else {
        message.error(data.error);
      }
    } catch {
      message.error("Error guardando");
    } finally {
      setSaving(false);
    }
  };

  const generarTokenPortal = async (codigoCliente: string) => {
    setGenerandoToken(true);
    try {
      const res = await fetch("/api/cobranzas/portal/generar-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo_cliente: codigoCliente }),
      });
      const data = await res.json();
      if (data.url) {
        message.success("Token generado. URL copiada al portapapeles.");
        navigator.clipboard.writeText(data.url).catch(() => {});
        Modal.info({
          title: "Link del Portal del Cliente",
          content: (
            <div>
              <p>Envíe este enlace al cliente para que vea su estado de cuenta:</p>
              <Input.TextArea value={data.url} readOnly rows={2} />
              <p style={{ marginTop: 8, color: "#999", fontSize: 12 }}>
                Expira: {new Date(data.expiracion).toLocaleDateString("es-DO")}
              </p>
            </div>
          ),
        });
      } else {
        message.error(data.error || "Error generando token");
      }
    } catch {
      message.error("Error de conexión");
    } finally {
      setGenerandoToken(false);
    }
  };

  const columns: ColumnsType<ClienteEnriquecido> = [
    {
      title: "Cliente",
      key: "cliente",
      fixed: "left",
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.nombre_cliente}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.codigo_cliente} | RNC: {record.rnc || "N/D"}
          </Text>
        </Space>
      ),
    },
    {
      title: "Contacto",
      key: "contacto",
      width: 200,
      render: (_, record) => {
        const email = record.email_enriq || record.email_softec;
        const tel = record.whatsapp_enriq || record.telefono_softec;
        return (
          <Space direction="vertical" size={0}>
            {email ? (
              <Text style={{ fontSize: 12 }}>
                <MailOutlined /> {email}
              </Text>
            ) : (
              <Text type="danger" style={{ fontSize: 12 }}>
                <MailOutlined /> Sin email
              </Text>
            )}
            {tel ? (
              <Text style={{ fontSize: 12 }}>
                <PhoneOutlined /> {tel}
              </Text>
            ) : (
              <Text type="danger" style={{ fontSize: 12 }}>
                <PhoneOutlined /> Sin teléfono
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "Estado",
      key: "estado",
      width: 120,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          {record.no_contactar && <Tag color="red"><StopOutlined /> No contactar</Tag>}
          {record.pausa_hasta && <Tag color="orange">Pausado</Tag>}
          {!record.no_contactar && !record.pausa_hasta && (
            <Tag color="green"><CheckCircleOutlined /> Activo</Tag>
          )}
        </Space>
      ),
    },
    {
      title: "Facturas",
      dataIndex: "total_facturas_pendientes",
      key: "facturas",
      width: 80,
      align: "center",
      sorter: (a, b) => a.total_facturas_pendientes - b.total_facturas_pendientes,
    },
    {
      title: "Saldo Pendiente",
      dataIndex: "saldo_total",
      key: "saldo",
      width: 140,
      align: "right",
      sorter: (a, b) => a.saldo_total - b.saldo_total,
      defaultSortOrder: "descend",
      render: (val: number) => (
        <Text strong style={{ color: "#cf1322" }}>
          {formatMonto(val)}
        </Text>
      ),
    },
    {
      title: "Acciones",
      key: "acciones",
      width: 180,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditar(record)}
          >
            Editar
          </Button>
          <Tooltip title="Generar link del portal">
            <Button
              size="small"
              icon={<LinkOutlined />}
              onClick={() => generarTokenPortal(record.codigo_cliente)}
              loading={generandoToken}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>
          <UserOutlined /> Clientes — Enriquecimiento de Datos
        </Title>
        <Button icon={<ReloadOutlined />} onClick={fetchClientes}>
          Actualizar
        </Button>
      </div>

      {/* Estadísticas */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="Total Clientes" value={stats.totalClientes} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="Sin Email" value={stats.sinEmail} valueStyle={{ color: "#faad14" }} prefix={<WarningOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="Sin WhatsApp" value={stats.sinWhatsapp} valueStyle={{ color: "#faad14" }} prefix={<WarningOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="Sin Contacto" value={stats.sinContacto} valueStyle={{ color: "#cf1322" }} prefix={<StopOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* Filtros */}
      <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Input
          placeholder="Buscar cliente..."
          prefix={<SearchOutlined />}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ width: 300 }}
          allowClear
        />
        <Segmented
          options={[
            { label: "Todos", value: "todos" },
            { label: "Sin Email", value: "sin_email" },
            { label: "Sin WhatsApp", value: "sin_whatsapp" },
            { label: "Sin Contacto", value: "sin_contacto" },
            { label: "Pausados", value: "pausados" },
          ]}
          value={filtro}
          onChange={(v) => setFiltro(v as string)}
        />
      </Space>

      {/* Tabla */}
      <Table
        columns={columns}
        dataSource={clientes}
        rowKey="codigo_cliente"
        loading={loading}
        pagination={{ pageSize: 50, showTotal: (t) => `${t} clientes` }}
        size="small"
        scroll={{ x: 1000 }}
      />

      {/* Drawer de edición */}
      <Drawer
        title={selectedCliente ? `Editar: ${selectedCliente.nombre_cliente}` : "Editar Cliente"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={400}
        extra={
          <Button type="primary" onClick={() => form.submit()} loading={saving}>
            Guardar
          </Button>
        }
      >
        {selectedCliente && (
          <>
            <Card size="small" style={{ marginBottom: 16 }}>
              <Text type="secondary">Datos de Softec (solo lectura):</Text>
              <div style={{ marginTop: 8 }}>
                <div>Email: <Text code>{selectedCliente.email_softec || "No registrado"}</Text></div>
                <div>Tel: <Text code>{selectedCliente.telefono_softec || "No registrado"}</Text></div>
                <div>Contacto cobros: <Text code>{selectedCliente.contacto_cobros_softec || "No registrado"}</Text></div>
              </div>
            </Card>

            <Form form={form} layout="vertical" onFinish={handleGuardar}>
              <Form.Item name="email" label="Email (enriquecido)">
                <Input placeholder="email@empresa.com" />
              </Form.Item>
              <Form.Item name="whatsapp" label="WhatsApp (enriquecido)">
                <Input placeholder="809-555-0000" />
              </Form.Item>
              <Form.Item name="contacto_cobros" label="Contacto de Cobros">
                <Input placeholder="Nombre del contacto" />
              </Form.Item>
              <Form.Item name="canal_preferido" label="Canal Preferido">
                <Select>
                  <Select.Option value="WHATSAPP">WhatsApp</Select.Option>
                  <Select.Option value="EMAIL">Email</Select.Option>
                  <Select.Option value="AMBOS">Ambos</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="no_contactar" label="No Contactar" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="notas_cobros" label="Notas de Cobros">
                <Input.TextArea rows={3} placeholder="Notas internas..." />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>
    </div>
  );
}

