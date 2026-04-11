"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Card,
  Table,
  Typography,
  Tag,
  Statistic,
  Row,
  Col,
  Alert,
  Spin,
  Button,
  Space,
  Divider,
  Empty,
  Result,
} from "antd";
import {
  FileTextOutlined,
  DollarOutlined,
  CalendarOutlined,
  FilePdfOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Title, Text } = Typography;

interface FacturaPortal {
  numero_interno: number;
  ncf_fiscal: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  dias_vencido: number;
  total_factura: number;
  total_pagado: number;
  saldo_pendiente: number;
  moneda: string;
  tiene_pdf: boolean;
  url_pdf: string | null;
}

interface AcuerdoPago {
  id: number;
  ij_inum: number;
  monto_prometido: number;
  fecha_prometida: string;
  estado: string;
}

interface PortalData {
  cliente: { codigo: string; nombre: string };
  facturas: FacturaPortal[];
  acuerdos: AcuerdoPago[];
  resumen: { total_facturas: number; saldo_total: number };
  modo: "live" | "mock";
}

function formatMonto(monto: number, moneda: string = "DOP"): string {
  const simbolo = moneda === "USD" ? "US$" : "RD$";
  return `${simbolo}${monto.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFecha(fecha: string): string {
  const d = new Date(fecha);
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${d.getDate()}/${meses[d.getMonth()]}/${d.getFullYear()}`;
}

export default function PortalClientePage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) throw new Error("TOKEN_INVALIDO");
          throw new Error("ERROR_SERVIDOR");
        }
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f0f2f5" }}>
        <Spin size="large" tip="Cargando su estado de cuenta..." />
      </div>
    );
  }

  if (error === "TOKEN_INVALIDO") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f0f2f5" }}>
        <Result
          status="403"
          title="Enlace no válido"
          subTitle="Este enlace ha expirado o no es válido. Solicite uno nuevo a su ejecutivo de cuenta."
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f0f2f5" }}>
        <Result
          status="500"
          title="Error"
          subTitle="No se pudieron cargar los datos. Intente nuevamente más tarde."
        />
      </div>
    );
  }

  const columns: ColumnsType<FacturaPortal> = [
    {
      title: "Factura",
      dataIndex: "ncf_fiscal",
      key: "ncf",
      render: (ncf: string, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{ncf || `IN-${record.numero_interno}`}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            #{record.numero_interno}
          </Text>
        </Space>
      ),
    },
    {
      title: "Fecha",
      key: "fechas",
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>Emitida: {formatFecha(record.fecha_emision)}</Text>
          <Text style={{ fontSize: 12 }}>Vence: {formatFecha(record.fecha_vencimiento)}</Text>
        </Space>
      ),
    },
    {
      title: "Estado",
      key: "estado",
      render: (_: unknown, record) => {
        if (record.dias_vencido <= 0) {
          return <Tag color="green">Vigente</Tag>;
        }
        if (record.dias_vencido <= 15) {
          return <Tag color="gold">{record.dias_vencido} dias vencida</Tag>;
        }
        if (record.dias_vencido <= 30) {
          return <Tag color="orange">{record.dias_vencido} dias vencida</Tag>;
        }
        return <Tag color="red">{record.dias_vencido} dias vencida</Tag>;
      },
    },
    {
      title: "Total",
      dataIndex: "total_factura",
      key: "total",
      align: "right",
      render: (val: number, record) => formatMonto(val, record.moneda),
    },
    {
      title: "Pagado",
      dataIndex: "total_pagado",
      key: "pagado",
      align: "right",
      render: (val: number, record) => formatMonto(val, record.moneda),
    },
    {
      title: "Saldo",
      dataIndex: "saldo_pendiente",
      key: "saldo",
      align: "right",
      render: (val: number, record) => (
        <Text strong style={{ color: val > 0 ? "#f5222d" : "#52c41a" }}>
          {formatMonto(val, record.moneda)}
        </Text>
      ),
    },
    {
      title: "PDF",
      key: "pdf",
      align: "center",
      render: (_: unknown, record) =>
        record.tiene_pdf && record.url_pdf ? (
          <Button
            type="link"
            icon={<FilePdfOutlined />}
            href={record.url_pdf}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver
          </Button>
        ) : (
          <Text type="secondary">--</Text>
        ),
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", padding: "24px 16px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {/* Header */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
            <div>
              <Title level={4} style={{ margin: 0 }}>
                Suministros Guipak, S.R.L.
              </Title>
              <Text type="secondary">Estado de Cuenta</Text>
            </div>
            <div style={{ textAlign: "right" }}>
              <Title level={5} style={{ margin: 0 }}>
                {data.cliente.nombre}
              </Title>
              <Text type="secondary">Cod: {data.cliente.codigo}</Text>
            </div>
          </div>
        </Card>

        {data.modo === "mock" && (
          <Alert
            message="Datos de demostración"
            description="Estos son datos de ejemplo. El estado de cuenta real estará disponible próximamente."
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* Resumen */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12}>
            <Card>
              <Statistic
                title="Facturas Pendientes"
                value={data.resumen.total_facturas}
                prefix={<FileTextOutlined />}
                valueStyle={{ color: "#1890ff" }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12}>
            <Card>
              <Statistic
                title="Saldo Total Pendiente"
                value={data.resumen.saldo_total}
                prefix={<DollarOutlined />}
                precision={2}
                valueStyle={{ color: "#cf1322" }}
                formatter={(val) => formatMonto(Number(val))}
              />
            </Card>
          </Col>
        </Row>

        {/* Acuerdos de pago activos */}
        {data.acuerdos && data.acuerdos.length > 0 && (
          <Card
            title={<><ClockCircleOutlined /> Acuerdos de Pago Activos</>}
            style={{ marginBottom: 16 }}
          >
            {data.acuerdos.map((a) => (
              <div key={a.id} style={{ marginBottom: 8, padding: 8, background: "#f6ffed", borderRadius: 4 }}>
                <Space>
                  <Tag color="blue">Factura #{a.ij_inum}</Tag>
                  <Text>Monto: {formatMonto(a.monto_prometido)}</Text>
                  <Text type="secondary">
                    <CalendarOutlined /> Fecha: {formatFecha(a.fecha_prometida)}
                  </Text>
                </Space>
              </div>
            ))}
          </Card>
        )}

        {/* Tabla de facturas */}
        <Card title={<><FileTextOutlined /> Detalle de Facturas Pendientes</>}>
          {data.facturas.length > 0 ? (
            <Table
              columns={columns}
              dataSource={data.facturas}
              rowKey="numero_interno"
              pagination={false}
              size="small"
              scroll={{ x: 700 }}
            />
          ) : (
            <Empty description="No hay facturas pendientes" />
          )}
        </Card>

        <Divider />

        {/* Footer */}
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Si tiene alguna consulta sobre su estado de cuenta, comuníquese con su ejecutivo de ventas.
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            Suministros Guipak, S.R.L. — Sistema de Cobranzas
          </Text>
        </div>
      </div>
    </div>
  );
}
