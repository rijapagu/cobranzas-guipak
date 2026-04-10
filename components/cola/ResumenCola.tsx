"use client";

import { Card, Col, Row, Statistic } from "antd";
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";

interface Props {
  pendientes: number;
  aprobadas_hoy: number;
  descartadas_hoy: number;
  escaladas_hoy: number;
}

export default function ResumenCola({ pendientes, aprobadas_hoy, descartadas_hoy, escaladas_hoy }: Props) {
  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="Pendientes"
            value={pendientes}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ color: "#faad14" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="Aprobadas Hoy"
            value={aprobadas_hoy}
            prefix={<CheckCircleOutlined />}
            valueStyle={{ color: "#52c41a" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="Descartadas Hoy"
            value={descartadas_hoy}
            prefix={<CloseCircleOutlined />}
            valueStyle={{ color: "#ff4d4f" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="Escaladas"
            value={escaladas_hoy}
            prefix={<ExclamationCircleOutlined />}
            valueStyle={{ color: "#fa8c16" }}
          />
        </Card>
      </Col>
    </Row>
  );
}
