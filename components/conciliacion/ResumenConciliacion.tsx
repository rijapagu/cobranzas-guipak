"use client";

import { Card, Col, Row, Statistic } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  QuestionCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { formatMonto } from "@/lib/utils/formato";

interface Props {
  conciliadas: number;
  por_aplicar: number;
  desconocidas: number;
  cheques_devueltos?: number;
  monto_conciliado: number;
  monto_por_aplicar: number;
  monto_desconocido: number;
  monto_devuelto?: number;
}

export default function ResumenConciliacion(props: Props) {
  const tieneDevueltos = (props.cheques_devueltos ?? 0) > 0;

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={24} sm={tieneDevueltos ? 6 : 8}>
        <Card style={{ borderLeft: "4px solid #52c41a" }}>
          <Statistic
            title="Conciliado"
            value={props.conciliadas}
            prefix={<CheckCircleOutlined />}
            valueStyle={{ color: "#52c41a" }}
            suffix="transacciones"
          />
          <div style={{ marginTop: 4, color: "#666", fontSize: 13 }}>
            {formatMonto(props.monto_conciliado)}
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={tieneDevueltos ? 6 : 8}>
        <Card style={{ borderLeft: "4px solid #fa8c16" }}>
          <Statistic
            title="Por Aplicar"
            value={props.por_aplicar}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ color: "#fa8c16" }}
            suffix="transacciones"
          />
          <div style={{ marginTop: 4, color: "#666", fontSize: 13 }}>
            {formatMonto(props.monto_por_aplicar)}
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={tieneDevueltos ? 6 : 8}>
        <Card style={{ borderLeft: "4px solid #f5222d" }}>
          <Statistic
            title="Desconocido"
            value={props.desconocidas}
            prefix={<QuestionCircleOutlined />}
            valueStyle={{ color: "#f5222d" }}
            suffix="transacciones"
          />
          <div style={{ marginTop: 4, color: "#666", fontSize: 13 }}>
            {formatMonto(props.monto_desconocido)}
          </div>
        </Card>
      </Col>
      {tieneDevueltos && (
        <Col xs={24} sm={6}>
          <Card style={{ borderLeft: "4px solid #722ed1", background: "#faf0ff" }}>
            <Statistic
              title="Cheques Devueltos"
              value={props.cheques_devueltos}
              prefix={<WarningOutlined />}
              valueStyle={{ color: "#722ed1" }}
              suffix="cheques"
            />
            <div style={{ marginTop: 4, color: "#722ed1", fontSize: 13, fontWeight: 600 }}>
              {formatMonto(props.monto_devuelto ?? 0)}
            </div>
          </Card>
        </Col>
      )}
    </Row>
  );
}
