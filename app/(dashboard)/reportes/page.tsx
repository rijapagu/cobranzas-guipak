"use client";

import { useState } from "react";
import {
  Typography,
  Card,
  Row,
  Col,
  Button,
  Space,
  DatePicker,
  Input,
  message,
  Divider,
} from "antd";
import {
  FileExcelOutlined,
  DownloadOutlined,
  FileTextOutlined,
  TeamOutlined,
  HistoryOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

export default function ReportesPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fechasGestiones, setFechasGestiones] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, "day"),
    dayjs(),
  ]);
  const [clienteEstadoCuenta, setClienteEstadoCuenta] = useState("");

  const descargarReporte = async (url: string, nombre: string) => {
    setDownloading(nombre);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error descargando reporte");
      }

      const blob = await res.blob();
      const a = document.createElement("a");
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;

      // Extraer nombre del header o usar default
      const disposition = res.headers.get("Content-Disposition");
      const filename = disposition?.match(/filename="(.+)"/)?.[1] || `${nombre}.xlsx`;
      a.download = filename;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      message.success(`Reporte ${nombre} descargado`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Error descargando");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <Title level={4}>
        <FileTextOutlined /> Reportes
      </Title>
      <Paragraph type="secondary">
        Exporta reportes en formato Excel para análisis externo.
      </Paragraph>

      <Row gutter={[16, 16]}>
        {/* Cartera Vencida Completa */}
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <FileExcelOutlined style={{ color: "#52c41a" }} />
                <span>Cartera Vencida Completa</span>
              </Space>
            }
          >
            <Paragraph type="secondary">
              Todas las facturas vencidas con datos del cliente, segmento, montos y contacto.
              Ideal para análisis general de cartera.
            </Paragraph>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloading === "cartera"}
              onClick={() => descargarReporte("/api/cobranzas/reportes/cartera-excel", "cartera")}
              block
            >
              Descargar Excel
            </Button>
          </Card>
        </Col>

        {/* Historial de Gestiones */}
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <HistoryOutlined style={{ color: "#1890ff" }} />
                <span>Historial de Gestiones</span>
              </Space>
            }
          >
            <Paragraph type="secondary">
              Todas las gestiones del período seleccionado: generadas, aprobadas, enviadas,
              descartadas.
            </Paragraph>
            <Space direction="vertical" style={{ width: "100%" }}>
              <RangePicker
                value={fechasGestiones}
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    setFechasGestiones([dates[0], dates[1]]);
                  }
                }}
                style={{ width: "100%" }}
                format="DD/MM/YYYY"
              />
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloading === "gestiones"}
                onClick={() =>
                  descargarReporte(
                    `/api/cobranzas/reportes/gestiones-excel?desde=${fechasGestiones[0].format("YYYY-MM-DD")}&hasta=${fechasGestiones[1].format("YYYY-MM-DD")}`,
                    "gestiones"
                  )
                }
                block
              >
                Descargar Excel
              </Button>
            </Space>
          </Card>
        </Col>

        {/* Estado de Cuenta por Cliente */}
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <TeamOutlined style={{ color: "#fa8c16" }} />
                <span>Estado de Cuenta por Cliente</span>
              </Space>
            }
          >
            <Paragraph type="secondary">
              Facturas pendientes de un cliente específico. Útil para enviar al cliente o
              para revisión interna.
            </Paragraph>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input
                placeholder="Código del cliente (ej: 0000274)"
                value={clienteEstadoCuenta}
                onChange={(e) => setClienteEstadoCuenta(e.target.value)}
              />
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={downloading === "estado-cuenta"}
                disabled={!clienteEstadoCuenta.trim()}
                onClick={() =>
                  descargarReporte(
                    `/api/cobranzas/reportes/estado-cuenta-excel?cliente=${clienteEstadoCuenta.trim()}`,
                    "estado-cuenta"
                  )
                }
                block
              >
                Descargar Excel
              </Button>
            </Space>
          </Card>
        </Col>

        {/* Info adicional */}
        <Col xs={24} md={12}>
          <Card title="Información" style={{ height: "100%" }}>
            <Space direction="vertical">
              <div>
                <Text strong>Formato:</Text> Microsoft Excel (.xlsx)
              </div>
              <div>
                <Text strong>Datos:</Text> Si Softec no está conectado, se usan datos de demostración.
              </div>
              <Divider />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Todos los reportes quedan registrados en el log de auditoría con usuario
                y timestamp (CP-08).
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
