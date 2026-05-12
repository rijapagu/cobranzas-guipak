"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConfigProvider,
  Typography,
  Card,
  Row,
  Col,
  Calendar,
  Badge,
  List,
  Button,
  Drawer,
  Form,
  Input,
  Select,
  DatePicker,
  TimePicker,
  Tag,
  Space,
  message,
  Popconfirm,
  Empty,
  Segmented,
  Checkbox,
} from "antd";
import {
  PlusOutlined,
  CheckCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  PhoneOutlined,
  BankOutlined,
  FileTextOutlined,
  TeamOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/es";
import esES from "antd/locale/es_ES";

dayjs.locale("es");

const { Title, Text } = Typography;
const { TextArea } = Input;

type Tipo = "LLAMAR" | "DEPOSITAR_CHEQUE" | "SEGUIMIENTO" | "DOCUMENTO" | "REUNION" | "CHEQUE_DEVUELTO" | "OTRO";
type Estado = "PENDIENTE" | "EN_PROGRESO" | "HECHA" | "CANCELADA";
type Prioridad = "BAJA" | "MEDIA" | "ALTA";
type Origen = "MANUAL" | "ACUERDO_PAGO" | "CADENCIA" | "CONCILIACION";

interface Tarea {
  id: number;
  titulo: string;
  descripcion: string | null;
  tipo: Tipo;
  fecha_vencimiento: string;
  hora: string | null;
  codigo_cliente: string | null;
  ij_inum: number | null;
  estado: Estado;
  prioridad: Prioridad;
  asignada_a: string | null;
  creado_por: string;
  origen: Origen;
  origen_ref: string | null;
  completada_at: string | null;
  completada_por: string | null;
  notas_completado: string | null;
}

const TIPO_META: Record<Tipo, { label: string; color: string; icon: React.ReactNode }> = {
  LLAMAR: { label: "Llamar", color: "blue", icon: <PhoneOutlined /> },
  DEPOSITAR_CHEQUE: { label: "Depositar cheque", color: "green", icon: <BankOutlined /> },
  SEGUIMIENTO: { label: "Seguimiento", color: "purple", icon: <EyeOutlined /> },
  DOCUMENTO: { label: "Documento", color: "orange", icon: <FileTextOutlined /> },
  REUNION: { label: "Reunión", color: "magenta", icon: <TeamOutlined /> },
  CHEQUE_DEVUELTO: { label: "Cheque devuelto", color: "red", icon: <BankOutlined /> },
  OTRO: { label: "Otro", color: "default", icon: null },
};

const PRIORIDAD_COLOR: Record<Prioridad, string> = { ALTA: "red", MEDIA: "gold", BAJA: "default" };
const ESTADO_COLOR: Record<Estado, string> = {
  PENDIENTE: "default",
  EN_PROGRESO: "processing",
  HECHA: "success",
  CANCELADA: "default",
};

/**
 * Normaliza una fecha proveniente de la API a YYYY-MM-DD sin shift de timezone.
 * MySQL DATE → mysql2 → JSON serializa como "2026-05-02T00:00:00.000Z" o similar.
 * Si dejamos que dayjs parsee, el cliente en UTC-4 lee "2026-05-01T20:00" y se
 * pierde un día. Tomamos los primeros 10 chars cuando ya están en formato fecha.
 */
function fmtFecha(s: string): string {
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return dayjs(s).format("YYYY-MM-DD");
}

export default function TareasPage() {
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [loading, setLoading] = useState(false);
  const [vista, setVista] = useState<"calendario" | "lista">("calendario");
  const [diaSeleccionado, setDiaSeleccionado] = useState<Dayjs>(dayjs());
  const [incluirCompletadas, setIncluirCompletadas] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editando, setEditando] = useState<Tarea | null>(null);
  const [form] = Form.useForm();

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const desde = dayjs().subtract(30, "day").format("YYYY-MM-DD");
      const hasta = dayjs().add(90, "day").format("YYYY-MM-DD");
      const params = new URLSearchParams({ desde, hasta });
      if (incluirCompletadas) params.set("incluir_completadas", "1");
      const res = await fetch(`/api/cobranzas/tareas?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error cargando");
      setTareas(data.tareas || []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [incluirCompletadas]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const tareasPorDia = useMemo(() => {
    const m: Record<string, Tarea[]> = {};
    for (const t of tareas) {
      const k = fmtFecha(t.fecha_vencimiento);
      (m[k] = m[k] || []).push(t);
    }
    return m;
  }, [tareas]);

  const tareasDelDia = useMemo(() => {
    const k = diaSeleccionado.format("YYYY-MM-DD");
    return tareasPorDia[k] || [];
  }, [tareasPorDia, diaSeleccionado]);

  const tareasAtrasadas = useMemo(() => {
    const hoy = dayjs().format("YYYY-MM-DD");
    return tareas.filter(
      (t) => fmtFecha(t.fecha_vencimiento) < hoy && (t.estado === "PENDIENTE" || t.estado === "EN_PROGRESO")
    );
  }, [tareas]);

  function abrirNueva(fecha?: Dayjs) {
    setEditando(null);
    form.resetFields();
    form.setFieldsValue({
      tipo: "OTRO",
      prioridad: "MEDIA",
      fecha_vencimiento: fecha ?? dayjs(),
    });
    setDrawerOpen(true);
  }

  function abrirEditar(t: Tarea) {
    setEditando(t);
    form.setFieldsValue({
      titulo: t.titulo,
      descripcion: t.descripcion,
      tipo: t.tipo,
      fecha_vencimiento: dayjs(fmtFecha(t.fecha_vencimiento), "YYYY-MM-DD"),
      hora: t.hora ? dayjs(t.hora, "HH:mm:ss") : null,
      codigo_cliente: t.codigo_cliente,
      prioridad: t.prioridad,
      asignada_a: t.asignada_a,
    });
    setDrawerOpen(true);
  }

  async function guardar() {
    try {
      const v = await form.validateFields();
      const payload = {
        titulo: v.titulo,
        descripcion: v.descripcion || null,
        tipo: v.tipo,
        fecha_vencimiento: v.fecha_vencimiento.format("YYYY-MM-DD"),
        hora: v.hora ? v.hora.format("HH:mm:ss") : null,
        codigo_cliente: v.codigo_cliente || null,
        prioridad: v.prioridad,
        asignada_a: v.asignada_a || null,
      };
      const url = editando
        ? `/api/cobranzas/tareas/${editando.id}`
        : `/api/cobranzas/tareas`;
      const method = editando ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error guardando");
      message.success(editando ? "Tarea actualizada" : "Tarea creada");
      setDrawerOpen(false);
      cargar();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  }

  async function marcarHecha(id: number, notas?: string) {
    try {
      const res = await fetch(`/api/cobranzas/tareas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "HECHA", notas_completado: notas || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Error");
      }
      message.success("Tarea marcada como hecha");
      cargar();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  }

  async function eliminar(id: number) {
    try {
      const res = await fetch(`/api/cobranzas/tareas/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Error");
      }
      message.success("Tarea cancelada");
      cargar();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  }

  function dateCellRender(value: Dayjs) {
    const k = value.format("YYYY-MM-DD");
    const items = tareasPorDia[k] || [];
    const pendientes = items.filter((t) => t.estado === "PENDIENTE" || t.estado === "EN_PROGRESO");
    if (pendientes.length === 0) return null;
    return (
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {pendientes.slice(0, 3).map((t) => (
          <li key={t.id} style={{ fontSize: 11, lineHeight: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <Badge status={ESTADO_COLOR[t.estado] as "default" | "processing" | "success" | "error" | "warning"} text={t.titulo} />
          </li>
        ))}
        {pendientes.length > 3 && (
          <li style={{ fontSize: 11, color: "#888" }}>+{pendientes.length - 3} más</li>
        )}
      </ul>
    );
  }

  const renderTarea = (t: Tarea) => {
    const meta = TIPO_META[t.tipo];
    const completada = t.estado === "HECHA" || t.estado === "CANCELADA";
    return (
      <List.Item
        key={t.id}
        actions={
          completada
            ? [
                <Tag color={ESTADO_COLOR[t.estado] === "success" ? "success" : "default"} key="estado">
                  {t.estado}
                </Tag>,
              ]
            : [
                <Button
                  key="hecha"
                  type="link"
                  icon={<CheckCircleOutlined />}
                  onClick={() => marcarHecha(t.id)}
                >
                  Hecha
                </Button>,
                <Button
                  key="editar"
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => abrirEditar(t)}
                >
                  Editar
                </Button>,
                <Popconfirm
                  key="del"
                  title="¿Cancelar esta tarea?"
                  onConfirm={() => eliminar(t.id)}
                  okText="Sí"
                  cancelText="No"
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>
                    Cancelar
                  </Button>
                </Popconfirm>,
              ]
        }
      >
        <List.Item.Meta
          avatar={meta.icon}
          title={
            <Space wrap>
              <Text strong style={{ textDecoration: completada ? "line-through" : "none" }}>
                {t.titulo}
              </Text>
              <Tag color={meta.color}>{meta.label}</Tag>
              <Tag color={PRIORIDAD_COLOR[t.prioridad]}>{t.prioridad}</Tag>
              {t.origen !== "MANUAL" && <Tag color="cyan">{t.origen}</Tag>}
              {t.hora && <Tag>{t.hora.slice(0, 5)}</Tag>}
            </Space>
          }
          description={
            <Space direction="vertical" size={0} style={{ width: "100%" }}>
              {t.descripcion && <Text type="secondary">{t.descripcion}</Text>}
              {t.codigo_cliente && <Text type="secondary">Cliente: {t.codigo_cliente}</Text>}
              {t.asignada_a && <Text type="secondary">Asignada a: {t.asignada_a}</Text>}
            </Space>
          }
        />
      </List.Item>
    );
  };

  return (
    <ConfigProvider locale={esES}>
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={2} style={{ margin: 0 }}>Tareas y Calendario</Title>
          <Text type="secondary">Recordatorios, llamadas, depósitos y seguimientos</Text>
        </Col>
        <Col>
          <Space>
            <Checkbox
              checked={incluirCompletadas}
              onChange={(e) => setIncluirCompletadas(e.target.checked)}
            >
              Mostrar completadas
            </Checkbox>
            <Segmented
              options={[
                { label: "Calendario", value: "calendario" },
                { label: "Lista", value: "lista" },
              ]}
              value={vista}
              onChange={(v) => setVista(v as "calendario" | "lista")}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => abrirNueva()}>
              Nueva tarea
            </Button>
          </Space>
        </Col>
      </Row>

      {tareasAtrasadas.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 16, borderColor: "#ff4d4f" }}
          title={<Text type="danger">Atrasadas ({tareasAtrasadas.length})</Text>}
        >
          <List
            dataSource={tareasAtrasadas}
            renderItem={renderTarea}
            size="small"
          />
        </Card>
      )}

      {vista === "calendario" ? (
        <Row gutter={16}>
          <Col xs={24} lg={16}>
            <Card>
              <Calendar
                value={diaSeleccionado}
                onSelect={(d) => setDiaSeleccionado(d)}
                cellRender={(current, info) => (info.type === "date" ? dateCellRender(current) : null)}
              />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card
              title={`Tareas del ${diaSeleccionado.format("DD MMM YYYY")}`}
              extra={
                <Button size="small" icon={<PlusOutlined />} onClick={() => abrirNueva(diaSeleccionado)}>
                  Agregar
                </Button>
              }
              loading={loading}
            >
              {tareasDelDia.length === 0 ? (
                <Empty description="Sin tareas para este día" />
              ) : (
                <List dataSource={tareasDelDia} renderItem={renderTarea} size="small" />
              )}
            </Card>
          </Col>
        </Row>
      ) : (
        <Card loading={loading}>
          {tareas.length === 0 ? (
            <Empty description="Sin tareas" />
          ) : (
            <List dataSource={tareas} renderItem={renderTarea} />
          )}
        </Card>
      )}

      <Drawer
        title={editando ? "Editar tarea" : "Nueva tarea"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>Cancelar</Button>
            <Button type="primary" onClick={guardar}>
              Guardar
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="titulo"
            label="Título"
            rules={[{ required: true, min: 2, max: 200 }]}
          >
            <Input placeholder="Llamar a Master Clean" />
          </Form.Item>
          <Form.Item name="descripcion" label="Descripción">
            <TextArea rows={3} placeholder="Detalles opcionales" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="tipo" label="Tipo" rules={[{ required: true }]}>
                <Select
                  options={(Object.keys(TIPO_META) as Tipo[]).map((k) => ({
                    label: TIPO_META[k].label,
                    value: k,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="prioridad" label="Prioridad" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: "Alta", value: "ALTA" },
                    { label: "Media", value: "MEDIA" },
                    { label: "Baja", value: "BAJA" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item
                name="fecha_vencimiento"
                label="Fecha"
                rules={[{ required: true }]}
              >
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="hora" label="Hora (opcional)">
                <TimePicker style={{ width: "100%" }} format="HH:mm" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="codigo_cliente" label="Código cliente (opcional)">
            <Input placeholder="0000274" />
          </Form.Item>
          <Form.Item name="asignada_a" label="Asignada a (email u user)">
            <Input placeholder="cobrador@guipak.com" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
    </ConfigProvider>
  );
}
