"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Col,
  Row,
  Statistic,
  Typography,
  Table,
  Tag,
  Progress,
  Alert,
  Spin,
  Button,
  Space,
  Badge,
  Tooltip,
} from "antd";
import {
  DollarOutlined,
  FileTextOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  SendOutlined,
  MessageOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  RiseOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import EstadoCuentaDrawer from "@/components/clientes/EstadoCuentaDrawer";

const { Title, Text } = Typography;

interface DashboardKPIs {
  cartera_total: number;
  // CP-15: bruto vs neto. El backend ya los pobla; en mock pueden venir en 0.
  cartera_total_a_favor?: number;
  cartera_total_neta?: number;
  total_facturas: number;
  total_clientes: number;
  dso: number;
  segmentos: { segmento: string; facturas: number; clientes: number; saldo: number }[];
  gestiones_hoy: number;
  pendientes_aprobacion: number;
  enviadas_hoy: number;
  acuerdos_pendientes: number;
  acuerdos_cumplidos_mes: number;
  acuerdos_incumplidos_mes: number;
  wa_enviados_mes: number;
  wa_respondidos_mes: number;
  email_enviados_mes: number;
  email_respondidos_mes: number;
  // CP-15: top 10 ya viene ordenado por saldo_neto. Campos a_favor / neto
  // son opcionales para no romper con respuestas legacy o mock.
  top_clientes: {
    codigo: string;
    nombre: string;
    saldo: number;
    saldo_a_favor?: number;
    saldo_neto?: number;
    facturas: number;
  }[];
  promesas_vencidas: number;
  facturas_sin_gestion_30d: number;
  clientes_sin_contacto: number;
  modo: "live" | "mock";
}

const SEGMENTO_COLORS: Record<string, string> = {
  VERDE: "#52c41a",
  AMARILLO: "#faad14",
  NARANJA: "#fa8c16",
  ROJO: "#f5222d",
};

function formatMonto(monto: number): string {
  if (monto >= 1000000) {
    return `RD$${(monto / 1000000).toFixed(1)}M`;
  }
  if (monto >= 1000) {
    return `RD$${(monto / 1000).toFixed(0)}K`;
  }
  return `RD$${monto.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function formatMontoCompleto(monto: number): string {
  return `RD$${monto.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [clienteSeleccionado, setClienteSeleccionado] = useState<string | null>(null);

  const fetchKPIs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cobranzas/dashboard");
      const data = await res.json();
      setKpis(data);
    } catch {
      setKpis(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKPIs();
  }, [fetchKPIs]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" tip="Cargando KPIs..." />
      </div>
    );
  }

  if (!kpis) {
    return <Alert message="Error cargando datos del dashboard" type="error" />;
  }

  const totalAcuerdosMes = kpis.acuerdos_cumplidos_mes + kpis.acuerdos_incumplidos_mes;
  const tasaCumplimiento = totalAcuerdosMes > 0
    ? Math.round((kpis.acuerdos_cumplidos_mes / totalAcuerdosMes) * 100) : 0;

  const totalWa = kpis.wa_enviados_mes;
  const tasaRespuestaWa = totalWa > 0 ? Math.round((kpis.wa_respondidos_mes / totalWa) * 100) : 0;
  const totalEmail = kpis.email_enviados_mes;
  const tasaRespuestaEmail = totalEmail > 0 ? Math.round((kpis.email_respondidos_mes / totalEmail) * 100) : 0;

  // CP-15: si el backend ya pobló a favor / neto úsalos; si no, cae al bruto.
  const carteraNeta = kpis.cartera_total_neta ?? kpis.cartera_total;
  const carteraAFavor = kpis.cartera_total_a_favor ?? 0;
  const hayAnticipos = carteraAFavor > 0.01;

  const topColumns: ColumnsType<DashboardKPIs["top_clientes"][number]> = [
    {
      title: "#",
      key: "index",
      width: 40,
      render: (_v, _r, i) => <Text type="secondary">{i + 1}</Text>,
    },
    {
      title: "Cliente",
      key: "cliente",
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 12 }}>{r.nombre}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{r.codigo}</Text>
        </Space>
      ),
    },
    {
      // CP-15: la columna principal pasa a ser saldo NETO (lo cobrable real).
      // El bruto queda como subtítulo discreto solo cuando difiere del neto.
      title: "Saldo neto",
      key: "saldo",
      align: "right",
      render: (_, r) => {
        const neto = r.saldo_neto ?? r.saldo;
        const bruto = r.saldo;
        const difiere = Math.abs(bruto - neto) > 0.01;
        return (
          <Space direction="vertical" size={0} align="end">
            <Text strong style={{ color: "#cf1322" }}>
              {formatMontoCompleto(neto)}
            </Text>
            {difiere && (
              <Text type="secondary" style={{ fontSize: 10 }}>
                bruto {formatMonto(bruto)}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "Fact.",
      dataIndex: "facturas",
      key: "facturas",
      align: "center",
      width: 50,
    },
    {
      title: "",
      key: "ver",
      width: 36,
      render: (_, r) => (
        <Tooltip title="Ver estado de cuenta">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setClienteSeleccionado(r.codigo)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Dashboard</Title>
        <Space>
          {kpis.modo === "mock" && <Tag color="orange">Datos Mock</Tag>}
          <Button icon={<ReloadOutlined />} onClick={fetchKPIs} size="small">
            Actualizar
          </Button>
        </Space>
      </div>

      {/* Alertas activas */}
      {(kpis.promesas_vencidas > 0 || kpis.pendientes_aprobacion > 0) && (
        <Row gutter={[16, 8]} style={{ marginBottom: 16 }}>
          {kpis.promesas_vencidas > 0 && (
            <Col span={24}>
              <Alert
                message={`${kpis.promesas_vencidas} promesa${kpis.promesas_vencidas > 1 ? "s" : ""} de pago vencida${kpis.promesas_vencidas > 1 ? "s" : ""} sin cumplir`}
                type="error"
                showIcon
                icon={<ExclamationCircleOutlined />}
                banner
              />
            </Col>
          )}
          {kpis.pendientes_aprobacion > 0 && (
            <Col span={24}>
              <Alert
                message={`${kpis.pendientes_aprobacion} mensaje${kpis.pendientes_aprobacion > 1 ? "s" : ""} pendiente${kpis.pendientes_aprobacion > 1 ? "s" : ""} de aprobación`}
                type="warning"
                showIcon
                banner
              />
            </Col>
          )}
        </Row>
      )}

      {/* CP-15: tres cards de cartera — bruto / a favor / neto cobrable.
          Si no hay anticipos, las 3 muestran el mismo número (consistencia
          visual) y el subtítulo "a favor" queda en cero. */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="Cartera Vencida (bruta)"
              value={kpis.cartera_total}
              prefix={<DollarOutlined />}
              formatter={() => formatMonto(kpis.cartera_total)}
              valueStyle={{ color: "#cf1322" }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Suma de saldos pendientes en Softec
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="Saldo a Favor (anticipos)"
              value={carteraAFavor}
              prefix={<DollarOutlined />}
              formatter={() => formatMonto(carteraAFavor)}
              valueStyle={{ color: hayAnticipos ? "#1890ff" : "#8c8c8c" }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Recibos sin aplicar a facturas
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="Cartera Neta (cobrable)"
              value={carteraNeta}
              prefix={<DollarOutlined />}
              formatter={() => formatMonto(carteraNeta)}
              valueStyle={{ color: "#cf1322" }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {hayAnticipos
                ? "Bruto menos saldo a favor"
                : "Sin anticipos por descontar"}
            </Text>
          </Card>
        </Col>
      </Row>

      {/* KPIs secundarios */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="DSO (Days Sales Outstanding)"
              value={kpis.dso}
              prefix={<ClockCircleOutlined />}
              suffix="días"
              valueStyle={{ color: kpis.dso > 45 ? "#cf1322" : "#3f8600" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="Facturas Pendientes"
              value={kpis.total_facturas}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: "#faad14" }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              de {kpis.total_clientes} clientes
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="Gestiones Hoy"
              value={kpis.enviadas_hoy}
              prefix={<SendOutlined />}
              valueStyle={{ color: "#52c41a" }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {kpis.gestiones_hoy} generadas
            </Text>
          </Card>
        </Col>
      </Row>

      {/* Segmentos + Top Clientes */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Distribución por Segmento">
            {kpis.segmentos.map((seg) => {
              const porcentaje = kpis.cartera_total > 0
                ? Math.round((seg.saldo / kpis.cartera_total) * 100)
                : 0;
              return (
                <div key={seg.segmento} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <Space>
                      <Badge color={SEGMENTO_COLORS[seg.segmento] || "#d9d9d9"} />
                      <Text strong>{seg.segmento}</Text>
                      <Text type="secondary">
                        ({seg.facturas} fact. / {seg.clientes} clientes)
                      </Text>
                    </Space>
                    <Text strong>{formatMontoCompleto(seg.saldo)}</Text>
                  </div>
                  <Progress
                    percent={porcentaje}
                    strokeColor={SEGMENTO_COLORS[seg.segmento]}
                    showInfo={true}
                    size="small"
                  />
                </div>
              );
            })}
            {kpis.segmentos.length === 0 && (
              <Text type="secondary">Sin datos de segmentos</Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Top 10 Clientes con Mayor Saldo Neto">
            <Table
              columns={topColumns}
              dataSource={kpis.top_clientes}
              rowKey="codigo"
              pagination={false}
              size="small"
              onRow={(r) => ({
                onClick: () => setClienteSeleccionado(r.codigo),
                style: { cursor: "pointer" },
              })}
            />
          </Card>
        </Col>
      </Row>

      {/* Canales + Acuerdos */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <Card title={<><MessageOutlined /> Efectividad Canales (mes)</>}>
            <div style={{ marginBottom: 16 }}>
              <Text strong>WhatsApp</Text>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text type="secondary">Enviados: {kpis.wa_enviados_mes}</Text>
                <Text type="secondary">Respondidos: {kpis.wa_respondidos_mes}</Text>
              </div>
              <Progress
                percent={tasaRespuestaWa}
                strokeColor="#25D366"
                format={(p) => `${p}%`}
              />
            </div>
            <div>
              <Text strong>Email</Text>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text type="secondary">Enviados: {kpis.email_enviados_mes}</Text>
                <Text type="secondary">Respondidos: {kpis.email_respondidos_mes}</Text>
              </div>
              <Progress
                percent={tasaRespuestaEmail}
                strokeColor="#1890ff"
                format={(p) => `${p}%`}
              />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<><RiseOutlined /> Acuerdos de Pago</>}>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="Pendientes"
                  value={kpis.acuerdos_pendientes}
                  valueStyle={{ color: "#faad14", fontSize: 20 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="Cumplidos"
                  value={kpis.acuerdos_cumplidos_mes}
                  valueStyle={{ color: "#52c41a", fontSize: 20 }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="Incumplidos"
                  value={kpis.acuerdos_incumplidos_mes}
                  valueStyle={{ color: "#f5222d", fontSize: 20 }}
                />
              </Col>
            </Row>
            <div style={{ marginTop: 16 }}>
              <Text>Tasa de cumplimiento:</Text>
              <Progress
                percent={tasaCumplimiento}
                strokeColor={tasaCumplimiento >= 70 ? "#52c41a" : tasaCumplimiento >= 40 ? "#faad14" : "#f5222d"}
              />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<><WarningOutlined /> Alertas</>}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                <Text>Promesas vencidas</Text>
                <Badge
                  count={kpis.promesas_vencidas}
                  style={{ backgroundColor: kpis.promesas_vencidas > 0 ? "#f5222d" : "#d9d9d9" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                <Text>Pendientes aprobación</Text>
                <Badge
                  count={kpis.pendientes_aprobacion}
                  style={{ backgroundColor: kpis.pendientes_aprobacion > 0 ? "#faad14" : "#d9d9d9" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
                <Text>Clientes sin contacto</Text>
                <Badge
                  count={kpis.clientes_sin_contacto}
                  style={{ backgroundColor: kpis.clientes_sin_contacto > 0 ? "#fa8c16" : "#d9d9d9" }}
                />
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      <EstadoCuentaDrawer
        codigoCliente={clienteSeleccionado}
        onClose={() => setClienteSeleccionado(null)}
      />
    </div>
  );
}
