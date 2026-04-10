"use client";

import { useEffect, useState } from "react";
import { Drawer, Descriptions, Table, Tag, Space, Typography, Spin, Divider } from "antd";
import type { FacturaVencida, PagoAplicado } from "@/lib/types/cartera";
import { formatMonto, formatFecha, diasVencidoTexto } from "@/lib/utils/formato";
import SegmentoTag from "./SegmentoTag";
import ContactoIndicadores from "./ContactoIndicadores";

const { Text, Link } = Typography;

interface Props {
  factura: FacturaVencida | null;
  open: boolean;
  onClose: () => void;
}

export default function DetalleFactura({ factura, open, onClose }: Props) {
  const [pagos, setPagos] = useState<PagoAplicado[]>([]);
  const [loadingPagos, setLoadingPagos] = useState(false);

  useEffect(() => {
    if (factura && open) {
      setLoadingPagos(true);
      fetch(
        `/api/softec/estado-cuenta/${factura.codigo_cliente}?factura=${factura.numero_interno}`
      )
        .then((r) => r.json())
        .then((data) => setPagos(data.pagos || []))
        .catch(() => setPagos([]))
        .finally(() => setLoadingPagos(false));
    }
  }, [factura, open]);

  if (!factura) return null;

  return (
    <Drawer
      title={`Factura #${factura.numero_interno} — ${factura.nombre_cliente}`}
      open={open}
      onClose={onClose}
      width={640}
    >
      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="Cliente" span={2}>
          <Text strong>{factura.nombre_cliente}</Text>
          <br />
          <Text type="secondary">{factura.codigo_cliente}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="RNC">{factura.rnc}</Descriptions.Item>
        <Descriptions.Item label="NCF">{factura.ncf_fiscal}</Descriptions.Item>
        <Descriptions.Item label="Segmento">
          <SegmentoTag segmento={factura.segmento_riesgo} />
        </Descriptions.Item>
        <Descriptions.Item label="D\u00edas Vencido">
          <Text type="danger" strong>
            {diasVencidoTexto(factura.dias_vencido)}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="Emisi\u00f3n">{formatFecha(factura.fecha_emision)}</Descriptions.Item>
        <Descriptions.Item label="Vencimiento">{formatFecha(factura.fecha_vencimiento)}</Descriptions.Item>
        <Descriptions.Item label="Total">
          {formatMonto(factura.total_factura, factura.moneda)}
        </Descriptions.Item>
        <Descriptions.Item label="Pagado">
          {formatMonto(factura.total_pagado, factura.moneda)}
        </Descriptions.Item>
        <Descriptions.Item label="Saldo Pendiente" span={2}>
          <Text type="danger" strong style={{ fontSize: 18 }}>
            {formatMonto(factura.saldo_pendiente, factura.moneda)}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="Moneda">{factura.moneda}</Descriptions.Item>
        <Descriptions.Item label="Tasa Cambio">{factura.tasa_cambio}</Descriptions.Item>
        <Descriptions.Item label="T\u00e9rminos">{factura.terminos_pago}</Descriptions.Item>
        <Descriptions.Item label="Vendedor">{factura.vendedor}</Descriptions.Item>
        <Descriptions.Item label="Contacto Cobros" span={2}>
          {factura.contacto_cobros || <Text type="secondary">No asignado</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Canales" span={2}>
          <ContactoIndicadores
            telefono={factura.telefono}
            email={factura.email}
            tiene_pdf={factura.tiene_pdf}
          />
        </Descriptions.Item>
        {factura.tiene_pdf && factura.url_pdf && (
          <Descriptions.Item label="Factura PDF" span={2}>
            <Link href={factura.url_pdf} target="_blank">
              Ver PDF en Drive
            </Link>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="\u00daltimo Pago" span={2}>
          {factura.fecha_ultimo_pago
            ? formatFecha(factura.fecha_ultimo_pago)
            : <Tag color="default">Sin pagos registrados</Tag>
          }
        </Descriptions.Item>
      </Descriptions>

      <Divider>Historial de Pagos</Divider>

      {loadingPagos ? (
        <Spin />
      ) : pagos.length === 0 ? (
        <Text type="secondary">No hay pagos aplicados a esta factura</Text>
      ) : (
        <Table
          dataSource={pagos}
          rowKey="numero_recibo"
          size="small"
          pagination={false}
          columns={[
            {
              title: "Fecha",
              dataIndex: "fecha_pago",
              render: (v: string) => formatFecha(v),
            },
            {
              title: "Recibo",
              dataIndex: "numero_recibo",
            },
            {
              title: "Monto",
              dataIndex: "monto_aplicado",
              render: (v: number) => formatMonto(v),
              align: "right" as const,
            },
            {
              title: "Referencia",
              dataIndex: "referencia_pago",
              ellipsis: true,
            },
          ]}
        />
      )}
    </Drawer>
  );
}
