"use client";

import { useState } from "react";
import { Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { FacturaVencida } from "@/lib/types/cartera";
import { formatMonto, formatFecha, diasVencidoTexto, colorSegmento } from "@/lib/utils/formato";
import SegmentoTag from "./SegmentoTag";
import ContactoIndicadores from "./ContactoIndicadores";
import DetalleFactura from "./DetalleFactura";

const { Text } = Typography;

interface Props {
  facturas: FacturaVencida[];
  loading: boolean;
}

export default function TablaCartera({ facturas, loading }: Props) {
  const [selected, setSelected] = useState<FacturaVencida | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const columns: ColumnsType<FacturaVencida> = [
    {
      title: "Cliente",
      key: "cliente",
      width: 220,
      fixed: "left" as const,
      sorter: (a, b) => a.nombre_cliente.localeCompare(b.nombre_cliente),
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{r.nombre_cliente}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{r.codigo_cliente}</Text>
        </div>
      ),
    },
    {
      title: "NCF",
      dataIndex: "ncf_fiscal",
      width: 160,
      ellipsis: true,
    },
    {
      title: "Vencimiento",
      dataIndex: "fecha_vencimiento",
      width: 110,
      sorter: (a, b) => new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime(),
      render: (v: string) => formatFecha(v),
    },
    {
      title: "D\u00edas",
      dataIndex: "dias_vencido",
      width: 120,
      sorter: (a, b) => a.dias_vencido - b.dias_vencido,
      defaultSortOrder: "descend",
      render: (dias: number) => (
        <Text style={{ color: dias > 30 ? "#f5222d" : dias > 15 ? "#fa8c16" : "#faad14" }}>
          {diasVencidoTexto(dias)}
        </Text>
      ),
    },
    {
      title: "Total",
      dataIndex: "total_factura",
      width: 140,
      align: "right" as const,
      sorter: (a, b) => a.total_factura - b.total_factura,
      render: (v: number, r) => formatMonto(v, r.moneda),
    },
    {
      title: "Saldo",
      dataIndex: "saldo_pendiente",
      width: 140,
      align: "right" as const,
      sorter: (a, b) => a.saldo_pendiente - b.saldo_pendiente,
      render: (v: number, r) => (
        <Text strong type="danger">
          {formatMonto(v, r.moneda)}
        </Text>
      ),
    },
    {
      title: "Segmento",
      dataIndex: "segmento_riesgo",
      width: 100,
      filters: [
        { text: "Rojo", value: "ROJO" },
        { text: "Naranja", value: "NARANJA" },
        { text: "Amarillo", value: "AMARILLO" },
        { text: "Verde", value: "VERDE" },
      ],
      onFilter: (value, record) => record.segmento_riesgo === value,
      render: (seg: FacturaVencida["segmento_riesgo"]) => <SegmentoTag segmento={seg} />,
    },
    {
      title: "Contacto",
      key: "contacto",
      width: 100,
      render: (_, r) => (
        <ContactoIndicadores
          telefono={r.telefono}
          email={r.email}
          tiene_pdf={r.tiene_pdf}
        />
      ),
    },
    {
      title: "Vendedor",
      dataIndex: "vendedor",
      width: 80,
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        dataSource={facturas}
        rowKey={(r) => `${r.localidad}-${r.numero_interno}`}
        loading={loading}
        size="small"
        scroll={{ x: 1200 }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          showTotal: (total) => `${total} facturas`,
        }}
        onRow={(record) => ({
          onClick: () => {
            setSelected(record);
            setDrawerOpen(true);
          },
          style: {
            cursor: "pointer",
            borderLeft: `3px solid ${colorSegmento(record.segmento_riesgo)}`,
          },
        })}
      />
      <DetalleFactura
        factura={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
