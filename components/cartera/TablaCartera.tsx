"use client";

import { useState } from "react";
import { Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { FacturaVencida } from "@/lib/types/cartera";
import { formatMonto, formatFecha, diasVencidoTexto, colorSegmento } from "@/lib/utils/formato";
import SegmentoTag from "./SegmentoTag";
import ContactoIndicadores from "./ContactoIndicadores";
import DetalleFactura from "./DetalleFactura";

const { Text } = Typography;

// CP-15: mapa codigo_cliente -> ajuste. Lo provee el endpoint
// /api/softec/cartera-vencida en `saldos_clientes`. Si falta para un
// cliente, las columnas nuevas caen al saldo bruto (compat).
interface SaldoClienteAjuste {
  saldo_pendiente: number;
  saldo_a_favor: number;
  saldo_neto: number;
  cubierto_por_anticipo: boolean;
}

interface Props {
  facturas: FacturaVencida[];
  loading: boolean;
  saldosClientes?: Record<string, SaldoClienteAjuste>;
}

export default function TablaCartera({ facturas, loading, saldosClientes }: Props) {
  const [selected, setSelected] = useState<FacturaVencida | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const columns: ColumnsType<FacturaVencida> = [
    {
      title: "Cliente",
      key: "cliente",
      width: 240,
      fixed: "left" as const,
      sorter: (a, b) => a.nombre_cliente.localeCompare(b.nombre_cliente),
      render: (_, r) => {
        const ajuste = saldosClientes?.[r.codigo_cliente];
        const cubierto = r.cubierto_por_anticipo || ajuste?.cubierto_por_anticipo;
        return (
          <div>
            <Text strong style={{ fontSize: 13 }}>{r.nombre_cliente}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>{r.codigo_cliente}</Text>
            {cubierto && (
              <div style={{ marginTop: 4 }}>
                <Tooltip title="El cliente tiene saldo a favor que cubre todo su pendiente. No requiere cobranza.">
                  <Tag color="blue" style={{ fontSize: 10, marginRight: 0 }}>
                    Cubierta por anticipo
                  </Tag>
                </Tooltip>
              </div>
            )}
          </div>
        );
      },
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
      title: "Total",
      dataIndex: "total_factura",
      width: 140,
      align: "right" as const,
      sorter: (a, b) => a.total_factura - b.total_factura,
      render: (v: number, r) => formatMonto(v, r.moneda),
    },
    {
      title: "Saldo factura",
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
      // CP-15: saldo a favor a nivel cliente (se repite en filas del
      // mismo cliente). Solo muestra si hay anticipo del cliente.
      title: "A favor (cliente)",
      key: "saldo_a_favor",
      width: 140,
      align: "right" as const,
      sorter: (a, b) => {
        const af = saldosClientes?.[a.codigo_cliente]?.saldo_a_favor ?? 0;
        const bf = saldosClientes?.[b.codigo_cliente]?.saldo_a_favor ?? 0;
        return af - bf;
      },
      render: (_, r) => {
        const favor = saldosClientes?.[r.codigo_cliente]?.saldo_a_favor ?? 0;
        if (favor <= 0.01) {
          return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        }
        return (
          <Text style={{ color: "#1890ff" }}>
            {formatMonto(favor, r.moneda)}
          </Text>
        );
      },
    },
    {
      // CP-15: saldo neto cobrable a nivel cliente.
      title: "Neto (cliente)",
      key: "saldo_neto",
      width: 140,
      align: "right" as const,
      sorter: (a, b) => {
        const an = saldosClientes?.[a.codigo_cliente]?.saldo_neto ?? a.saldo_pendiente;
        const bn = saldosClientes?.[b.codigo_cliente]?.saldo_neto ?? b.saldo_pendiente;
        return an - bn;
      },
      render: (_, r) => {
        const ajuste = saldosClientes?.[r.codigo_cliente];
        const neto = ajuste?.saldo_neto ?? r.saldo_pendiente;
        const cubierto = ajuste?.cubierto_por_anticipo || r.cubierto_por_anticipo;
        return (
          <Text strong style={{ color: cubierto ? "#52c41a" : "#cf1322" }}>
            {formatMonto(neto, r.moneda)}
          </Text>
        );
      },
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
        scroll={{ x: 1480 }}
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
