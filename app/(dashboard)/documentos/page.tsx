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
  Modal,
  Form,
  message,
} from "antd";
import {
  FileTextOutlined,
  SearchOutlined,
  PlusOutlined,
  CloudUploadOutlined,
  LinkOutlined,
  FilePdfOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Title, Text } = Typography;

interface Documento {
  id: number;
  ij_local: string;
  ij_inum: number;
  codigo_cliente: string;
  google_drive_id: string;
  url_pdf: string;
  nombre_archivo: string;
  fecha_escaneo: string;
  subido_por: string | null;
  origen: string;
  created_at: string;
}

interface EstadisticasDocs {
  total_docs: number;
  crm_webhook: number;
  manual: number;
}

function formatFecha(fecha: string): string {
  const d = new Date(fecha);
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${d.getDate()}/${meses[d.getMonth()]}/${d.getFullYear()}`;
}

export default function DocumentosPage() {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [stats, setStats] = useState<EstadisticasDocs>({ total_docs: 0, crm_webhook: 0, manual: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busqueda) params.set("busqueda", busqueda);
      params.set("page", String(page));
      params.set("limit", "50");

      const res = await fetch(`/api/cobranzas/documentos?${params}`);
      const data = await res.json();
      setDocumentos(data.documentos || []);
      setTotal(data.total || 0);
      setStats(data.estadisticas || { total_docs: 0, crm_webhook: 0, manual: 0 });
    } catch {
      message.error("Error cargando documentos");
    } finally {
      setLoading(false);
    }
  }, [busqueda, page]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleSubirManual = async (values: {
    ij_inum: string;
    codigo_cliente: string;
    google_drive_id: string;
    nombre_archivo?: string;
  }) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/cobranzas/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ij_inum: Number(values.ij_inum),
          codigo_cliente: values.codigo_cliente,
          google_drive_id: values.google_drive_id,
          nombre_archivo: values.nombre_archivo,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success(`Documento ${data.accion} exitosamente`);
        setModalOpen(false);
        form.resetFields();
        fetchDocs();
      } else {
        message.error(data.error || "Error subiendo documento");
      }
    } catch {
      message.error("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<Documento> = [
    {
      title: "Factura",
      key: "factura",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>IN-{record.ij_inum}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Cliente: {record.codigo_cliente}
          </Text>
        </Space>
      ),
    },
    {
      title: "Archivo",
      dataIndex: "nombre_archivo",
      key: "archivo",
      render: (val: string) => (
        <Space>
          <FilePdfOutlined style={{ color: "#f5222d" }} />
          <Text>{val || "Sin nombre"}</Text>
        </Space>
      ),
    },
    {
      title: "Origen",
      dataIndex: "origen",
      key: "origen",
      render: (val: string) =>
        val === "CRM_WEBHOOK" ? (
          <Tag color="blue">CRM</Tag>
        ) : (
          <Tag color="green">Manual</Tag>
        ),
    },
    {
      title: "Fecha Escaneo",
      dataIndex: "fecha_escaneo",
      key: "fecha",
      render: (val: string) => formatFecha(val),
    },
    {
      title: "Subido por",
      dataIndex: "subido_por",
      key: "subido",
      render: (val: string | null) => val || <Text type="secondary">Webhook</Text>,
    },
    {
      title: "Acciones",
      key: "acciones",
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<LinkOutlined />}
            href={record.url_pdf}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
          >
            Ver PDF
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>
          <FileTextOutlined /> Gestión Documental
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchDocs}>
            Actualizar
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            Vincular PDF Manual
          </Button>
        </Space>
      </div>

      {/* Estadísticas */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Total Documentos"
              value={stats.total_docs}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Via CRM Webhook"
              value={stats.crm_webhook}
              prefix={<CloudUploadOutlined />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Subidos Manualmente"
              value={stats.manual}
              prefix={<PlusOutlined />}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
      </Row>

      {/* Búsqueda */}
      <Input
        placeholder="Buscar por # factura, código cliente o nombre archivo..."
        prefix={<SearchOutlined />}
        value={busqueda}
        onChange={(e) => { setBusqueda(e.target.value); setPage(1); }}
        style={{ marginBottom: 16, maxWidth: 500 }}
        allowClear
      />

      {/* Tabla */}
      <Table
        columns={columns}
        dataSource={documentos}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize: 50,
          total,
          onChange: setPage,
          showTotal: (t) => `${t} documentos`,
        }}
        size="small"
      />

      {/* Modal subida manual */}
      <Modal
        title="Vincular PDF Manual"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        okText="Vincular"
      >
        <Form form={form} layout="vertical" onFinish={handleSubirManual}>
          <Form.Item
            name="ij_inum"
            label="Número Interno Factura"
            rules={[{ required: true, message: "Requerido" }]}
          >
            <Input placeholder="Ej: 456" type="number" />
          </Form.Item>
          <Form.Item
            name="codigo_cliente"
            label="Código del Cliente"
            rules={[{ required: true, message: "Requerido" }]}
          >
            <Input placeholder="Ej: 0000274" />
          </Form.Item>
          <Form.Item
            name="google_drive_id"
            label="Google Drive ID del PDF"
            rules={[{ required: true, message: "Requerido" }]}
            extra="El ID se encuentra en la URL del archivo de Google Drive"
          >
            <Input placeholder="Ej: 1BxiMxxxxxxxx" />
          </Form.Item>
          <Form.Item name="nombre_archivo" label="Nombre del Archivo (opcional)">
            <Input placeholder="Ej: factura-456.pdf" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
