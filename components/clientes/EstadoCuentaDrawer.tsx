"use client";

import { useEffect, useState } from "react";
import {
  Drawer,
  Table,
  Tag,
  Typography,
  Space,
  Statistic,
  Row,
  Col,
  Card,
  Button,
  Spin,
  Alert,
  Tooltip,
} from "antd";
import {
  DownloadOutlined,
  DollarOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Text, Title } = Typography;

interface FacturaEstadoCuenta {
  numero: number;
  ncf: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  dias_vencido: number;
  total: number;
  pagado: number;
  saldo: number;
  moneda: string;
}

interface EstadoCuenta {
  codigo_cliente: string;
  nombre_cliente: string;
  facturas: FacturaEstadoCuenta[];
  resumen: {
    total_facturas: number;
    saldo_bruto: number;
    saldo_a_favor: number;
    saldo_neto: number;
    cubierto_por_anticipo: boolean;
  };
}

function fmt(n: number) {
  return `RD$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtFecha(raw: string) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const columns: ColumnsType<FacturaEstadoCuenta> = [
  {
    title: "# Factura",
    dataIndex: "numero",
    key: "numero",
    width: 90,
    render: (v) => <Text strong>{v}</Text>,
  },
  {
    title: "NCF",
    dataIndex: "ncf",
    key: "ncf",
    width: 140,
    render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
  },
  {
    title: "F. Vencimiento",
    dataIndex: "fecha_vencimiento",
    key: "fecha_vencimiento",
    width: 110,
    render: (v) => fmtFecha(v),
  },
  {
    title: "Días",
    dataIndex: "dias_vencido",
    key: "dias_vencido",
    width: 70,
    align: "center",
    render: (dias: number) => {
      if (dias > 30) return <Tag color="red">{dias}d</Tag>;
      if (dias > 15) return <Tag color="orange">{dias}d</Tag>;
      if (dias > 0) return <Tag color="gold">{dias}d</Tag>;
      return <Tag color="green">{Math.abs(dias)}d</Tag>;
    },
  },
  {
    title: "Total",
    dataIndex: "total",
    key: "total",
    align: "right",
    width: 130,
    render: (v) => fmt(Number(v)),
  },
  {
    title: "Pagado",
    dataIndex: "pagado",
    key: "pagado",
    align: "right",
    width: 130,
    render: (v) => (
      <Text type={Number(v) > 0 ? "success" : "secondary"}>{fmt(Number(v))}</Text>
    ),
  },
  {
    title: "Saldo",
    dataIndex: "saldo",
    key: "saldo",
    align: "right",
    width: 130,
    render: (v) => <Text strong style={{ color: "#cf1322" }}>{fmt(Number(v))}</Text>,
  },
];

interface Props {
  codigoCliente: string | null;
  onClose: () => void;
}

export default function EstadoCuentaDrawer({ codigoCliente, onClose }: Props) {
  const [data, setData] = useState<EstadoCuenta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    if (!codigoCliente) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/softec/estado-cuenta-cliente/${encodeURIComponent(codigoCliente)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message ?? "Error cargando datos"))
      .finally(() => setLoading(false));
  }, [codigoCliente]);

  const descargarExcel = async () => {
    if (!codigoCliente) return;
    setDescargando(true);
    try {
      const res = await fetch(
        `/api/cobranzas/reportes/estado-cuenta-excel?cliente=${encodeURIComponent(codigoCliente)}`
      );
      if (!res.ok) throw new Error("Error descargando");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition");
      a.download = disposition?.match(/filename="(.+)"/)?.[1] ?? `estado-cuenta-${codigoCliente}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } finally {
      setDescargando(false);
    }
  };

  const hayAnticipos = (data?.resumen.saldo_a_favor ?? 0) > 0.01;

  return (
    <Drawer
      title={
        data ? (
          <Space direction="vertical" size={0}>
            <Text strong style={{ fontSize: 15 }}>{data.nombre_cliente}</Text>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: "normal" }}>
              {data.codigo_cliente} · Estado de Cuenta
            </Text>
          </Space>
        ) : (
          "Estado de Cuenta"
        )
      }
      open={!!codigoCliente}
      onClose={onClose}
      width={820}
      extra={
        <Button
          icon={<DownloadOutlined />}
          onClick={descargarExcel}
          loading={descargando}
          disabled={!data}
          size="small"
        >
          Excel
        </Button>
      }
    >
      {loading && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin tip="Cargando estado de cuenta..." />
        </div>
      )}

      {error && <Alert message={error} type="error" showIcon />}

      {data && !loading && (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          {/* Resumen de montos */}
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={hayAnticipos ? 8 : 12}>
              <Card size="small">
                <Statistic
                  title="Saldo Bruto"
                  value={data.resumen.saldo_bruto}
                  formatter={() => fmt(data.resumen.saldo_bruto)}
                  valueStyle={{ color: "#cf1322", fontSize: 18 }}
                  prefix={<DollarOutlined />}
                />
              </Card>
            </Col>
            {hayAnticipos && (
              <Col xs={24} sm={8}>
                <Card size="small">
                  <Statistic
                    title="A Favor / Anticipos"
                    value={data.resumen.saldo_a_favor}
                    formatter={() => fmt(data.resumen.saldo_a_favor)}
                    valueStyle={{ color: "#1890ff", fontSize: 18 }}
                    prefix={<DollarOutlined />}
                  />
                </Card>
              </Col>
            )}
            <Col xs={24} sm={hayAnticipos ? 8 : 12}>
              <Card size="small">
                <Statistic
                  title="Saldo Neto Cobrable"
                  value={data.resumen.saldo_neto}
                  formatter={() => fmt(data.resumen.saldo_neto)}
                  valueStyle={{
                    color: data.resumen.cubierto_por_anticipo ? "#52c41a" : "#cf1322",
                    fontSize: 18,
                  }}
                  prefix={<DollarOutlined />}
                />
                {data.resumen.cubierto_por_anticipo && (
                  <Tag color="blue" style={{ marginTop: 4 }}>Cubierto por anticipo</Tag>
                )}
              </Card>
            </Col>
          </Row>

          {/* Nota aclaratoria */}
          <Alert
            type="info"
            icon={<InfoCircleOutlined />}
            showIcon
            message={
              <Text style={{ fontSize: 12 }}>
                Se muestran <strong>todas las facturas pendientes</strong> (vencidas y por vencer),
                igual que el Estado de Cuenta en Softec. El Dashboard solo muestra facturas ya vencidas.
              </Text>
            }
          />

          {/* Tabla de facturas */}
          <div>
            <Title level={5} style={{ marginBottom: 8 }}>
              Facturas Pendientes ({data.resumen.total_facturas})
            </Title>
            <Table
              columns={columns}
              dataSource={data.facturas}
              rowKey="numero"
              pagination={false}
              size="small"
              scroll={{ x: 720 }}
              rowClassName={(r) =>
                r.dias_vencido > 0 ? "factura-vencida" : "factura-por-vencer"
              }
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4}>
                    <Text strong>Total</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    <Text strong>{fmt(data.facturas.reduce((s, f) => s + f.total, 0))}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <Text strong style={{ color: "#52c41a" }}>
                      {fmt(data.facturas.reduce((s, f) => s + f.pagado, 0))}
                    </Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">
                    <Text strong style={{ color: "#cf1322" }}>
                      {fmt(data.resumen.saldo_bruto)}
                    </Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </div>

          {/* Leyenda de días */}
          <Space size={8} wrap>
            <Text type="secondary" style={{ fontSize: 11 }}>Días vencido:</Text>
            <Tag color="green">Por vencer</Tag>
            <Tag color="gold">1–15 días</Tag>
            <Tag color="orange">16–30 días</Tag>
            <Tag color="red">+30 días</Tag>
          </Space>
        </Space>
      )}
    </Drawer>
  );
}
