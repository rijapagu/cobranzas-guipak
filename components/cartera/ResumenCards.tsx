"use client";

import { Card, Col, Row, Statistic, Spin } from "antd";
import type { ResumenSegmento, SegmentoRiesgo } from "@/lib/types/cartera";
import { formatMonto, colorSegmento, bgColorSegmento } from "@/lib/utils/formato";

const iconEmoji: Record<SegmentoRiesgo, string> = {
  ROJO: "\uD83D\uDD34",
  NARANJA: "\uD83D\uDFE0",
  AMARILLO: "\uD83D\uDFE1",
  VERDE: "\uD83D\uDFE2",
};

const labelSegmento: Record<SegmentoRiesgo, string> = {
  ROJO: "Cr\u00edtico (30+ d\u00edas)",
  NARANJA: "Alto (16-30 d\u00edas)",
  AMARILLO: "Medio (1-15 d\u00edas)",
  VERDE: "Preventivo",
};

interface Props {
  segmentos: ResumenSegmento[];
  loading: boolean;
  filtroActivo?: SegmentoRiesgo | null;
  onClickSegmento: (segmento: SegmentoRiesgo) => void;
}

export default function ResumenCards({ segmentos, loading, filtroActivo, onClickSegmento }: Props) {
  const orden: SegmentoRiesgo[] = ["ROJO", "NARANJA", "AMARILLO", "VERDE"];

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
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
  );
}
