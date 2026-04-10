"use client";

import { useState } from "react";
import { Table, Typography, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CobranzaGestion } from "@/lib/types/cobranzas";
import { formatMonto, formatFecha, diasVencidoTexto, colorSegmento } from "@/lib/utils/formato";
import SegmentoTag from "@/components/cartera/SegmentoTag";
import DrawerAprobacion from "./DrawerAprobacion";

const { Text } = Typography;

const canalTag = (canal: string) => {
  const colors: Record<string, string> = {
    WHATSAPP: "#25D366",
    EMAIL: "#1890ff",
    AMBOS: "#722ed1",
  };
  return <Tag color={colors[canal] || "#666"}>{canal}</Tag>;
};

interface Props {
  gestiones: CobranzaGestion[];
  loading: boolean;
  onRefresh: () => void;
}

export default function TablaColaAprobacion({ gestiones, loading, onRefresh }: Props) {
  const [selected, setSelected] = useState<CobranzaGestion | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const columns: ColumnsType<CobranzaGestion> = [
    {
      title: "Cliente",
      key: "cliente",
      width: 200,
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            {r.nombre_cliente || r.codigo_cliente}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{r.codigo_cliente}</Text>
        </div>
      ),
    },
    {
      title: "Factura",
      dataIndex: "ij_inum",
      width: 90,
      render: (v: number) => `#${v}`,
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
      title: "Días",
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
      title: "Segmento",
      dataIndex: "segmento_riesgo",
      width: 100,
      filters: [
        { text: "Rojo", value: "ROJO" },
        { text: "Naranja", value: "NARANJA" },
        { text: "Amarillo", value: "AMARILLO" },
      ],
      onFilter: (value, record) => record.segmento_riesgo === value,
      render: (seg: CobranzaGestion["segmento_riesgo"]) => <SegmentoTag segmento={seg} />,
    },
    {
      title: "Canal",
      dataIndex: "canal",
      width: 100,
      render: (canal: string) => canalTag(canal),
    },
    {
      title: "Vencimiento",
      dataIndex: "fecha_vencimiento",
      width: 110,
      render: (v: string) => formatFecha(v),
    },
    {
      title: "Creada",
      dataIndex: "created_at",
      width: 110,
      render: (v: string) => formatFecha(v),
    },
  ];

  return (
    <>
      <Table
        columns={columns}
        dataSource={gestiones}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 1000 }}
        pagination={{
          pageSize: 15,
          showTotal: (total) => `${total} gestiones`,
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
      <DrawerAprobacion
        gestion={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onAccionCompletada={onRefresh}
      />
    </>
  );
}
