"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Select,
  InputNumber,
  Switch,
  message,
  Card,
  Row,
  Col,
  Statistic,
  Popconfirm,
  Alert,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";

const { Title, Text } = Typography;

interface Cadencia {
  id: number;
  segmento: string;
  dia_desde_vencimiento: number;
  accion: string;
  requiere_aprobacion: boolean;
  plantilla_mensaje_id: number | null;
  activa: boolean;
}

interface UltimoRun {
  descripcion: string;
  created_at: string;
}

const ACCIONES: Record<string, { label: string; color: string }> = {
  EMAIL: { label: "Correo electrónico", color: "blue" },
  WHATSAPP: { label: "WhatsApp", color: "green" },
  LLAMADA_TICKET: { label: "Tarea de llamada", color: "orange" },
  RECLASIFICAR: { label: "Reclasificar", color: "purple" },
  ESCALAR_LEGAL: { label: "Escalar a legal", color: "red" },
};

const SEGMENTOS: Record<string, { label: string; color: string }> = {
  VERDE: { label: "Verde (preventivo)", color: "green" },
  AMARILLO: { label: "Amarillo (1-15 días)", color: "gold" },
  NARANJA: { label: "Naranja (16-30 días)", color: "orange" },
  ROJO: { label: "Rojo (30+ días)", color: "red" },
};

export default function CadenciasPage() {
  const [cadencias, setCadencias] = useState<Cadencia[]>([]);
  const [ultimoRun, setUltimoRun] = useState<UltimoRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [ejecutando, setEjecutando] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<Cadencia | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchCadencias = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cobranzas/cadencias");
      const data = await res.json();
      setCadencias(data.cadencias ?? []);
      setUltimoRun(data.ultimo_run ?? null);
    } catch {
      message.error("Error cargando cadencias");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCadencias();
  }, [fetchCadencias]);

  const abrirCrear = () => {
    setEditando(null);
    form.resetFields();
    form.setFieldsValue({ requiere_aprobacion: true, activa: true });
    setModalOpen(true);
  };

  const abrirEditar = (c: Cadencia) => {
    setEditando(c);
    form.setFieldsValue({
      segmento: c.segmento,
      dia_desde_vencimiento: c.dia_desde_vencimiento,
      accion: c.accion,
      requiere_aprobacion: c.requiere_aprobacion,
      activa: c.activa,
    });
    setModalOpen(true);
  };

  const handleGuardar = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const method = editando ? "PUT" : "POST";
      const body = editando ? { id: editando.id, ...values } : values;
      const res = await fetch("/api/cobranzas/cadencias", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      message.success(editando ? "Cadencia actualizada" : "Cadencia creada");
      setModalOpen(false);
      fetchCadencias();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const handleEliminar = async (id: number) => {
    try {
      const res = await fetch(`/api/cobranzas/cadencias?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error");
      message.success("Cadencia eliminada");
      fetchCadencias();
    } catch {
      message.error("Error eliminando cadencia");
    }
  };

  const toggleActiva = async (c: Cadencia) => {
    await fetch("/api/cobranzas/cadencias", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, activa: !c.activa }),
    });
    fetchCadencias();
  };

  const ejecutarAhora = async () => {
    setEjecutando(true);
    try {
      const secret = prompt("INTERNAL_CRON_SECRET:");
      if (!secret) { setEjecutando(false); return; }
      const res = await fetch("/api/internal/cron/cadencias-horarias", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (data.ok) {
        const s = data.stats;
        message.success(
          `Completado: ${s.aplicadas} aplicadas, ${s.fastForward} fast-forward, ${s.omitidas} omitidas de ${s.evaluadas}`
        );
        fetchCadencias();
      } else {
        message.error(data.error || "Error");
      }
    } catch {
      message.error("Error al ejecutar");
    } finally {
      setEjecutando(false);
    }
  };

  const activas = cadencias.filter((c) => c.activa).length;
  const conAprobacion = cadencias.filter((c) => c.activa && c.requiere_aprobacion).length;

  const columns: ColumnsType<Cadencia> = [
    {
      title: "Segmento",
      dataIndex: "segmento",
      key: "segmento",
      render: (v: string) => (
        <Tag color={SEGMENTOS[v]?.color ?? "default"}>
          {SEGMENTOS[v]?.label ?? v}
        </Tag>
      ),
      filters: Object.keys(SEGMENTOS).map((s) => ({ text: SEGMENTOS[s].label, value: s })),
      onFilter: (value, record) => record.segmento === value,
    },
    {
      title: "Día",
      dataIndex: "dia_desde_vencimiento",
      key: "dia",
      sorter: (a, b) => a.dia_desde_vencimiento - b.dia_desde_vencimiento,
      render: (v: number) => <Text strong>Día {v}</Text>,
    },
    {
      title: "Acción",
      dataIndex: "accion",
      key: "accion",
      render: (v: string) => (
        <Tag color={ACCIONES[v]?.color ?? "default"}>
          {ACCIONES[v]?.label ?? v}
        </Tag>
      ),
    },
    {
      title: "Aprobación",
      dataIndex: "requiere_aprobacion",
      key: "aprobacion",
      render: (v: boolean) =>
        v ? (
          <Tag color="orange">Manual</Tag>
        ) : (
          <Tag color="green">Auto</Tag>
        ),
    },
    {
      title: "Estado",
      dataIndex: "activa",
      key: "activa",
      render: (v: boolean, record) => (
        <Switch
          checked={v}
          size="small"
          onChange={() => toggleActiva(record)}
          checkedChildren="Activa"
          unCheckedChildren="Inactiva"
        />
      ),
    },
    {
      title: "Acciones",
      key: "acciones",
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => abrirEditar(record)}
          />
          <Popconfirm
            title="¿Eliminar esta cadencia?"
            onConfirm={() => handleEliminar(record.id)}
            okText="Eliminar"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: "0 24px 24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          Cadencias Automáticas
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchCadencias} loading={loading}>
            Actualizar
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={ejecutarAhora}
            loading={ejecutando}
          >
            Ejecutar ahora
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={abrirCrear}>
            Nueva cadencia
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Las cadencias crean gestiones automáticamente cuando una factura cruza el umbral de días configurado. Las gestiones con aprobación Manual van a la Cola de Aprobación; las Auto se envían directamente (solo usar con cautela)."
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="Cadencias activas"
              value={activas}
              suffix={`/ ${cadencias.length}`}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Con aprobación manual"
              value={conAprobacion}
              valueStyle={{ color: "#fa8c16" }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ClockCircleOutlined style={{ color: "#1677ff", fontSize: 20 }} />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Último run
                </Text>
                <br />
                {ultimoRun ? (
                  <Text>
                    {dayjs(ultimoRun.created_at).format("DD/MMM/YYYY HH:mm")}
                  </Text>
                ) : (
                  <Text type="secondary">Sin ejecuciones registradas</Text>
                )}
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={cadencias}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
        rowClassName={(r) => (!r.activa ? "opacity-50" : "")}
      />

      <Modal
        title={editando ? "Editar cadencia" : "Nueva cadencia"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={editando ? "Guardar" : "Crear"}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleGuardar}
          initialValues={{ requiere_aprobacion: true, activa: true }}
        >
          <Form.Item
            name="segmento"
            label="Segmento"
            rules={[{ required: true }]}
          >
            <Select>
              {Object.entries(SEGMENTOS).map(([k, v]) => (
                <Select.Option key={k} value={k}>
                  {v.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="dia_desde_vencimiento"
            label="Día desde vencimiento"
            rules={[{ required: true }]}
            help="El job se dispara cuando la factura lleva al menos este número de días vencida"
          >
            <InputNumber min={0} max={365} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="accion"
            label="Acción"
            rules={[{ required: true }]}
          >
            <Select>
              {Object.entries(ACCIONES).map(([k, v]) => (
                <Select.Option key={k} value={k}>
                  {v.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="requiere_aprobacion"
            label="Requiere aprobación manual"
            valuePropName="checked"
          >
            <Switch
              checkedChildren="Manual (cola)"
              unCheckedChildren="Auto"
            />
          </Form.Item>

          {editando && (
            <Form.Item name="activa" label="Activa" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
