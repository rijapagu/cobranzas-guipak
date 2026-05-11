"use client";

import { Card, Col, Row, Statistic, Spin, Typography } from "antd";
import type { ResumenSegmento, SegmentoRiesgo } from "@/lib/types/cartera";
import { formatMonto, colorSegmento, bgColorSegmento } from "@/lib/utils/formato";

const { Text } = Typography;

const iconEmoji: Record<SegmentoRiesgo, string> = {
  ROJO: "🔴",
  NARANJA: "🟠",
  AMARILLO: "🟡",
  VERDE: "🟢",
};

const labelSegmento: Record<SegmentoRiesgo, string> = {
  ROJO: "Crítico (30+ días)",
  NARANJA: "Alto (16-30 días)",
  AMARILLO: "Medio (1-15 días)",
  VERDE: "Preventivo",
};

interface Props {
  segmentos: ResumenSegmento[];
  loading: boolean;
  filtroActivo?: SegmentoRiesgo | null;
  onClickSegmento: (segmento: SegmentoRiesgo) => void;
  // CP-15: si el endpoint devuelve totales globales con bruto/a favor/neto,
  // se renderiza una fila superior con esas tres cifras. Si vienen sin
  // anticipos, la fila se omite para no añadir ruido.
  totales?: {
    bruto: number;
    a_favor: number;
    neto: number;
  };
}

export default function ResumenCards({
  segmentos,
  loading,
  filtroActivo,
  onClickSegmento,
  totales,
}: Props) {
  const orden: SegmentoRiesgo[] = ["ROJO", "NARANJA", "AMARILLO", "VERDE"];

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  // CP-15: solo mostramos la fila de totales si hay anticipos relevantes
  // (más de un centavo). Sin anticipos, el bruto y el neto son iguales y
  // las 3 cards solo añadirían ruido.
  const hayAnticipos = !!totales && totales.a_favor > 0.01;

  return (
    <>
      {hayAnticipos && totales && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="Cartera bruta"
                value={formatMonto(totales.bruto)}
                valueStyle={{ color: "#cf1322", fontSize: 20 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Suma de saldos pendientes
              </Text>
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="Saldo a favor"
                value={formatMonto(totales.a_favor)}
                valueStyle={{ color: "#1890ff", fontSize: 20 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Anticipos sin aplicar
              </Text>
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="Cartera neta (cobrable)"
                value={formatMonto(totales.neto)}
                valueStyle={{ color: "#cf1322", fontSize: 20 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Bruto menos saldo a favor
              </Text>
            </Card>
          </Col>
        </Row>
      )}

      <Row gutter={[16, 16]}>
        {orden.map((seg) => {
          const data = segmentos.find((s) => s.segmento === seg);
          const isActive = filtroActivo === seg;
          return (
            <Col xs={24} sm={12} lg={6} key={seg}>
              <Card
                hoverable
                onClick={() => onClickSegmento(seg)}
                style={{
                  borderColor: isActive ? colorSegmento(seg) : undefined,
                  borderWidth: isActive ? 2 : 1,
                  background: bgColorSegmento(seg),
                  cursor: "pointer",
                }}
              >
                <Statistic
                  title={
                    <span>
                      {iconEmoji[seg]} {labelSegmento[seg]}
                    </span>
                  }
                  value={data ? formatMonto(data.saldo_total) : "RD$0.00"}
                  valueStyle={{ color: colorSegmento(seg), fontSize: 20 }}
                />
                <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
                  {data?.num_facturas || 0} facturas &middot; {data?.num_clientes || 0} clientes
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </>
  );
}
