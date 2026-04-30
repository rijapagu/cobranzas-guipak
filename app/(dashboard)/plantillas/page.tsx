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
  message,
  InputNumber,
  Tooltip,
  Alert,
  Popconfirm,
  Tabs,
} from "antd";
import {
  MailOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  StopOutlined,
  WarningOutlined,
  CodeOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

type Categoria = 'SECUENCIA' | 'BUEN_CLIENTE' | 'PROMESA_ROTA' | 'ESTADO_CUENTA';

interface Plantilla {
  id: number;
  nombre: string;
  descripcion: string | null;
  segmento: 'VERDE' | 'AMARILLO' | 'NARANJA' | 'ROJO';
  categoria: Categoria;
  dia_desde_vencimiento: number;
  orden_secuencia: number;
  asunto: string;
  cuerpo: string;
  tono: 'AMIGABLE' | 'MODERADO' | 'FORMAL' | 'FIRME' | 'LEGAL';
  requiere_aprobacion: number;
  activa: number;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

const SEGMENTO_COLORS = {
  VERDE: 'green',
  AMARILLO: 'gold',
  NARANJA: 'orange',
  ROJO: 'red',
};

const TONO_COLORS = {
  AMIGABLE: 'blue',
  MODERADO: 'cyan',
  FORMAL: 'purple',
  FIRME: 'orange',
  LEGAL: 'red',
};

const CATEGORIA_LABEL: Record<Categoria, string> = {
  SECUENCIA: 'Secuencia normal',
  BUEN_CLIENTE: 'Cliente con buen historial',
  PROMESA_ROTA: 'Promesa de pago incumplida',
  ESTADO_CUENTA: 'Estado de cuenta',
};

const CATEGORIA_COLORS: Record<Categoria, string> = {
  SECUENCIA: 'default',
  BUEN_CLIENTE: 'green',
  PROMESA_ROTA: 'volcano',
  ESTADO_CUENTA: 'blue',
};

const VARIABLES_DISPONIBLES = [
  { variable: '{{cliente}}', descripcion: 'Nombre del contacto o razón social' },
  { variable: '{{empresa_cliente}}', descripcion: 'Nombre de la empresa cliente' },
  { variable: '{{numero_factura}}', descripcion: 'Número de factura' },
  { variable: '{{monto}}', descripcion: 'Saldo pendiente formateado (RD$)' },
  { variable: '{{fecha_vencimiento}}', descripcion: 'Fecha de vencimiento (DD/MM/YYYY)' },
  { variable: '{{dias_vencida}}', descripcion: 'Días que lleva vencida' },
  { variable: '{{fecha_prometida_pago}}', descripcion: 'Fecha que el cliente prometió pagar (solo PROMESA_ROTA)' },
  { variable: '{{telefono_cobros}}', descripcion: 'Teléfono del depto. de cobros' },
];

export default function PlantillasPage() {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cobranzas/plantillas');
      const data = await res.json();
      setPlantillas(data.plantillas || []);
    } catch {
      message.error('Error cargando plantillas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abrirNueva = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      segmento: 'AMARILLO',
      categoria: 'SECUENCIA',
      dia_desde_vencimiento: 0,
      orden_secuencia: 1,
      tono: 'MODERADO',
      requiere_aprobacion: true,
      activa: true,
    });
    setDrawerOpen(true);
  };

  const abrirEdicion = (p: Plantilla) => {
    setEditingId(p.id);
    form.setFieldsValue({
      nombre: p.nombre,
      descripcion: p.descripcion,
      segmento: p.segmento,
      categoria: p.categoria,
      dia_desde_vencimiento: p.dia_desde_vencimiento,
      orden_secuencia: p.orden_secuencia,
      asunto: p.asunto,
      cuerpo: p.cuerpo,
      tono: p.tono,
      requiere_aprobacion: !!p.requiere_aprobacion,
      activa: !!p.activa,
    });
    setDrawerOpen(true);
  };

  const guardar = async () => {
    try {
      const values = await form.validateFields();
      const url = editingId
        ? `/api/cobranzas/plantillas/${editingId}`
        : '/api/cobranzas/plantillas';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const err = await res.json();
        message.error(err.error || 'Error guardando');
        return;
      }
      message.success(editingId ? 'Plantilla actualizada' : 'Plantilla creada');
      setDrawerOpen(false);
      cargar();
    } catch {
      // validación falló
    }
  };

  const archivar = async (id: number) => {
    const res = await fetch(`/api/cobranzas/plantillas/${id}`, { method: 'DELETE' });
    if (res.ok) {
      message.success('Plantilla archivada');
      cargar();
    } else {
      message.error('Error archivando');
    }
  };

  const toggleActiva = async (p: Plantilla) => {
    const res = await fetch(`/api/cobranzas/plantillas/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activa: !p.activa }),
    });
    if (res.ok) {
      message.success(`Plantilla ${p.activa ? 'desactivada' : 'activada'}`);
      cargar();
    }
  };

  const insertarVariable = (variable: string) => {
    const cuerpoActual = form.getFieldValue('cuerpo') || '';
    form.setFieldValue('cuerpo', cuerpoActual + variable);
  };

  const columns: ColumnsType<Plantilla> = [
    {
      title: '#',
      dataIndex: 'orden_secuencia',
      width: 60,
      render: (orden: number, record) => (
        <Tooltip title={`Orden ${orden} dentro de ${record.segmento}`}>
          <Tag color="blue">{orden}º</Tag>
        </Tooltip>
      ),
    },
    {
      title: 'Plantilla',
      dataIndex: 'nombre',
      render: (nombre: string, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{nombre}</Text>
          {record.descripcion && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.descripcion}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Segmento',
      dataIndex: 'segmento',
      width: 120,
      render: (s: keyof typeof SEGMENTO_COLORS) => (
        <Tag color={SEGMENTO_COLORS[s]}>{s}</Tag>
      ),
    },
    {
      title: 'Cuándo',
      dataIndex: 'dia_desde_vencimiento',
      width: 140,
      render: (dia: number) => {
        if (dia < 0) return <Text>{Math.abs(dia)} días antes</Text>;
        if (dia === 0) return <Text>Día de vencimiento</Text>;
        return <Text>+{dia} días vencida</Text>;
      },
    },
    {
      title: 'Tono',
      dataIndex: 'tono',
      width: 100,
      render: (t: keyof typeof TONO_COLORS) => (
        <Tag color={TONO_COLORS[t]}>{t}</Tag>
      ),
    },
    {
      title: 'Aprobación',
      dataIndex: 'requiere_aprobacion',
      width: 110,
      align: 'center',
      render: (val: number) =>
        val ? (
          <Tooltip title="Requiere aprobación humana antes de enviar">
            <Tag icon={<CheckCircleOutlined />} color="success">
              Manual
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="Se envía automáticamente sin pasar por cola de aprobación">
            <Tag color="orange">Auto</Tag>
          </Tooltip>
        ),
    },
    {
      title: 'Estado',
      dataIndex: 'activa',
      width: 100,
      align: 'center',
      render: (activa: number, record) => (
        <Switch
          checked={!!activa}
          onChange={() => toggleActiva(record)}
          checkedChildren={<CheckCircleOutlined />}
          unCheckedChildren={<StopOutlined />}
        />
      ),
    },
    {
      title: 'Acciones',
      width: 140,
      align: 'center',
      render: (_: unknown, record) => (
        <Space>
          <Tooltip title="Editar">
            <Button
              icon={<EditOutlined />}
              size="small"
              onClick={() => abrirEdicion(record)}
            />
          </Tooltip>
          <Popconfirm
            title="¿Archivar plantilla?"
            description="Quedará inactiva pero no se borrará del historial"
            onConfirm={() => archivar(record.id)}
          >
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Estadísticas
  const totalActivas = plantillas.filter((p) => p.activa).length;
  const porSegmento = (s: string) =>
    plantillas.filter((p) => p.segmento === s && p.activa).length;
  const porCategoria = (c: Categoria) =>
    plantillas.filter((p) => p.categoria === c);

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>
            <MailOutlined /> Plantillas de Correo
          </Title>
          <Text type="secondary">
            Configura los correos que se envían a los clientes según su segmento y días vencidos.
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={abrirNueva}>
          Nueva plantilla
        </Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Total activas" value={totalActivas} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="🟢 Verde" value={porSegmento('VERDE')} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="🟡 Amarillo" value={porSegmento('AMARILLO')} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="🟠 Naranja" value={porSegmento('NARANJA')} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="🔴 Rojo" value={porSegmento('ROJO')} />
          </Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="¿Cómo funciona?"
        description={
          <Paragraph style={{ marginBottom: 0 }}>
            Cada plantilla se aplica automáticamente cuando una factura cumple los criterios (segmento + días desde vencimiento). El sistema reemplaza las variables (ej. <code>{'{{cliente}}'}</code>) con los datos reales antes de enviar. Los correos pasan por la <b>cola de aprobación</b> a menos que marques &quot;Auto&quot;.
          </Paragraph>
        }
      />

      <Card>
        <Tabs
          items={(['SECUENCIA', 'BUEN_CLIENTE', 'PROMESA_ROTA', 'ESTADO_CUENTA'] as Categoria[]).map((cat) => {
            const data = porCategoria(cat);
            return {
              key: cat,
              label: (
                <span>
                  {CATEGORIA_LABEL[cat]}{' '}
                  <Tag color={CATEGORIA_COLORS[cat]} style={{ marginLeft: 4 }}>
                    {data.length}
                  </Tag>
                </span>
              ),
              children: (
                <Table
                  columns={columns}
                  dataSource={data}
                  rowKey="id"
                  loading={loading}
                  pagination={false}
                  size="middle"
                  expandable={{
                    expandedRowRender: (record) => (
                      <div style={{ background: '#fafafa', padding: 16, borderRadius: 4 }}>
                        <Text strong>Asunto: </Text>
                        <Text>{record.asunto}</Text>
                        <pre
                          style={{
                            marginTop: 8,
                            background: '#fff',
                            padding: 12,
                            borderRadius: 4,
                            border: '1px solid #e8e8e8',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'inherit',
                            fontSize: 13,
                          }}
                        >
                          {record.cuerpo}
                        </pre>
                      </div>
                    ),
                  }}
                />
              ),
            };
          })}
        />
      </Card>

      <Drawer
        title={editingId ? 'Editar plantilla' : 'Nueva plantilla'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={720}
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
          <Tabs
            items={[
              {
                key: 'config',
                label: 'Configuración',
                children: (
                  <>
                    <Form.Item name="nombre" label="Nombre" rules={[{ required: true, min: 2 }]}>
                      <Input placeholder="Ej. 4to aviso — amenaza legal" />
                    </Form.Item>

                    <Form.Item name="descripcion" label="Descripción interna">
                      <TextArea rows={2} placeholder="Para qué se usa esta plantilla (opcional)" />
                    </Form.Item>

                    <Form.Item
                      name="categoria"
                      label="Categoría"
                      rules={[{ required: true }]}
                      tooltip="Define cuándo se usa esta plantilla. Secuencia = flujo normal por días vencidos."
                    >
                      <Select
                        options={[
                          { value: 'SECUENCIA', label: 'Secuencia normal — escalada por días vencidos' },
                          { value: 'BUEN_CLIENTE', label: 'Cliente con buen historial — atraso puntual' },
                          { value: 'PROMESA_ROTA', label: 'Promesa de pago incumplida' },
                          { value: 'ESTADO_CUENTA', label: 'Estado de cuenta — envío rutinario' },
                        ]}
                      />
                    </Form.Item>

                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="segmento" label="Segmento" rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: 'VERDE', label: '🟢 VERDE — vence pronto' },
                              { value: 'AMARILLO', label: '🟡 AMARILLO — 1-15 días vencida' },
                              { value: 'NARANJA', label: '🟠 NARANJA — 16-30 días vencida' },
                              { value: 'ROJO', label: '🔴 ROJO — 30+ días vencida' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="tono" label="Tono">
                          <Select
                            options={[
                              { value: 'AMIGABLE', label: 'AMIGABLE — recordatorio cordial' },
                              { value: 'MODERADO', label: 'MODERADO — recordatorio profesional' },
                              { value: 'FORMAL', label: 'FORMAL — gestión activa' },
                              { value: 'FIRME', label: 'FIRME — última advertencia' },
                              { value: 'LEGAL', label: 'LEGAL — amenaza/proceso' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          name="dia_desde_vencimiento"
                          label="Días desde vencimiento"
                          tooltip="Negativo = antes del vencimiento. 0 = el día. Positivo = vencida X días."
                        >
                          <InputNumber style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="orden_secuencia"
                          label="Orden dentro del segmento"
                          tooltip="1, 2, 3... cuando hay varias plantillas para el mismo segmento."
                        >
                          <InputNumber min={1} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          name="requiere_aprobacion"
                          label="Aprobación humana"
                          valuePropName="checked"
                          tooltip="Si está activado, el correo va a la cola de aprobación antes de enviarse."
                        >
                          <Switch
                            checkedChildren="Manual"
                            unCheckedChildren="Auto"
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="activa" label="Activa" valuePropName="checked">
                          <Switch checkedChildren="Sí" unCheckedChildren="No" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: 'contenido',
                label: 'Contenido del correo',
                children: (
                  <>
                    <Form.Item name="asunto" label="Asunto" rules={[{ required: true, min: 2, max: 200 }]}>
                      <Input
                        placeholder="Ej. URGENTE: Factura {{factura}} - Pago Inmediato"
                        showCount
                        maxLength={200}
                      />
                    </Form.Item>

                    <Form.Item
                      name="cuerpo"
                      label="Cuerpo del correo"
                      rules={[{ required: true, min: 10 }]}
                    >
                      <TextArea
                        rows={14}
                        placeholder="Estimado/a {{contacto}},..."
                      />
                    </Form.Item>

                    <Card
                      size="small"
                      title={
                        <Space>
                          <CodeOutlined /> Variables disponibles
                        </Space>
                      }
                      style={{ background: '#fafafa' }}
                    >
                      <Space wrap>
                        {VARIABLES_DISPONIBLES.map((v) => (
                          <Tooltip key={v.variable} title={v.descripcion}>
                            <Tag
                              style={{ cursor: 'pointer' }}
                              onClick={() => insertarVariable(v.variable)}
                              icon={<PlusOutlined />}
                            >
                              <code>{v.variable}</code>
                            </Tag>
                          </Tooltip>
                        ))}
                      </Space>
                      <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                        Click para insertar al final del cuerpo. Se reemplazan automáticamente con los datos reales del cliente al enviar.
                      </Paragraph>
                    </Card>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Drawer>
    </div>
  );
}
