"use client";

import { Card, Col, Row, Statistic, Typography } from "antd";
import {
  DollarOutlined,
  FileTextOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";

const { Title } = Typography;

export default function DashboardPage() {
  return (
    <div>
      <Title level={4}>Dashboard</Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Cartera Vencida"
              value={0}
              prefix={<DollarOutlined />}
              suffix="DOP"
              valueStyle={{ color: "#cf1322" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Facturas Pendientes"
              value={0}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: "#faad14" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Pendientes Aprobación"
              value={0}
              prefix={<WarningOutlined />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Gestiones Hoy"
              value={0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Distribución por Segmento">
            <Typography.Text type="secondary">
              Conecta con Softec para ver datos reales
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Actividad Reciente">
            <Typography.Text type="secondary">
              Sin actividad registrada aún
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
