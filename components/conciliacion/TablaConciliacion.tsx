"use client";

import { useState } from "react";
import { Table, Tag, Tabs, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ConciliacionEntry, ClienteOption, EstadoConciliacion } from "@/lib/types/conciliacion";
import { formatMonto, formatFecha } from "@/lib/utils/formato";
import DrawerTransaccion from "./DrawerTransaccion";

const { Text } = Typography;

const estadoConfig: Record<EstadoConciliacion, { color: string; label: string }> = {
  CONCILIADO: { color: "green", label: "Conciliado" },
  POR_APLICAR: { color: "orange", label: "Por Aplicar" },
  DESCONOCIDO: { color: "red", label: "Desconocido" },
};

interface Props {
  entradas: ConciliacionEntry[];
  loading: boolean;
  clientes: ClienteOption[];
  onRefresh: () => void;
}

export default function TablaConciliacion({ entradas, loading, clientes, onRefresh }: Props) {
  const [selected, setSelected] = useState<ConciliacionEntry | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");

  const filtered = filtroEstado === "todos"
    ? entradas
    : entradas.filter((e) => e.estado === filtroEstado);

  const columns: ColumnsType<ConciliacionEntry> = [
    {
      title: "Fecha",
      dataIndex: "fecha_transaccion",
      width: 100,
      render: (v: string) => formatFecha(v),
      sorter: (a, b) => new Date(a.fecha_transaccion).getTime() - new Date(b.fecha_transaccion).getTime(),
    },
    {
      title: "Descripci\u00f3n",
      dataIndex: "descripcion",
      ellipsis: true,
      width: 250,
    },
    {
      title: "Referencia",
      dataIndex: "referencia",
      width: 120,
      ellipsis: true,
    },
    {
      title: "Monto",
      dataIndex: "monto",
      width: 140,
      align: "right" as const,
      sorter: (a, b) => a.monto - b.monto,
      render: (v: number, r) => (
        <Text strong>{formatMonto(v, r.moneda)}</Text>
      ),
    },
    {
      title: "Cuenta",
      dataIndex: "cuenta_origen",
      width: 130,
      ellipsis: true,
    },
    {
      title: "Estado",
      dataIndex: "estado",
      width: 110,
      render: (estado: EstadoConciliacion) => (
        <Tag color={estadoConfig[estado].color}>{estadoConfig[estado].label}</Tag>
      ),
    },
    {
      title: "Cliente",
      dataIndex: "codigo_cliente",
      width: 120,
      render: (v: string | null) => v || <Text type="secondary">-</Text>,
    },
  ];

  const counts = {
    todos: entradas.length,
    CONCILIADO: entradas.filter((e) => e.estado === "CONCILIADO").length,
    POR_APLICAR: entradas.filter((e) => e.estado === "POR_APLICAR").length,
    DESCONOCIDO: entradas.filter((e) => e.estado === "DESCONOCIDO").length,
  };

  return (
    <>
      <Tabs
        activeKey={filtroEstado}
        onChange={setFiltroEstado}
        items={[
          { key: "todos", label: `Todos (${counts.todos})` },
          { key: "CONCILIADO", label: `Conciliados (${counts.CONCILIADO})` },
          { key: "POR_APLICAR", label: `Por Aplicar (${counts.POR_APLICAR})` },
          { key: "DESCONOCIDO", label: `Desconocidos (${counts.DESCONOCIDO})` },
        ]}
      />
      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 15, showTotal: (t) => `${t} transacciones` }}
        onRow={(record) => ({
          onClick: () => {
            setSelected(record);
            setDrawerOpen(true);
          },
          style: {
            cursor: "pointer",
            borderLeft: `3px solid ${estadoConfig[record.estado].color === "green" ? "#52c41a" : estadoConfig[record.estado].color === "orange" ? "#fa8c16" : "#f5222d"}`,
          },
        })}
      />
      <DrawerTransaccion
        entrada={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRefresh={onRefresh}
        clientes={clientes}
      />
    </>
  );
}
