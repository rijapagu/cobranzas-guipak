"use client";

import { useCallback, useEffect, useState } from "react";
import { Typography, Button, Space, Tag, Alert } from "antd";
import { ReloadOutlined, ClockCircleOutlined } from "@ant-design/icons";
import type {
  FacturaVencida,
  ResumenSegmento,
  FiltrosCartera,
  SegmentoRiesgo,
} from "@/lib/types/cartera";
import { formatFecha } from "@/lib/utils/formato";
import ResumenCards from "@/components/cartera/ResumenCards";
import FiltrosCarteraComp from "@/components/cartera/FiltrosCartera";
import TablaCartera from "@/components/cartera/TablaCartera";

const { Title, Text } = Typography;

// CP-15: el endpoint /resumen-segmentos puede traer `total_a_favor` y
// `total_neto` (campos opcionales para no romper consumers viejos). Si
// vienen, la fila superior de cartera muestra bruto/a favor/neto.
interface SaldoCliente {
  saldo_pendiente: number;
  saldo_a_favor: number;
  saldo_neto: number;
  cubierto_por_anticipo: boolean;
}

export default function CarteraPage() {
  // Data
  const [facturas, setFacturas] = useState<FacturaVencida[]>([]);
  const [segmentos, setSegmentos] = useState<ResumenSegmento[]>([]);
  const [totales, setTotales] = useState<
    { bruto: number; a_favor: number; neto: number } | undefined
  >(undefined);
  const [saldosClientes, setSaldosClientes] = useState<Record<string, SaldoCliente>>({});
  const [modo, setModo] = useState<"live" | "mock">("mock");
  const [ultimaConsulta, setUltimaConsulta] = useState<string>("");

  // UI
  const [loadingFacturas, setLoadingFacturas] = useState(true);
  const [loadingResumen, setLoadingResumen] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosCartera>({});
  const [filtroSegmentoCard, setFiltroSegmentoCard] = useState<SegmentoRiesgo | null>(null);

  // Vendedores extraídos de los datos
  const [vendedores, setVendedores] = useState<string[]>([]);

  const fetchResumen = useCallback(async () => {
    setLoadingResumen(true);
    try {
      const res = await fetch("/api/softec/resumen-segmentos");
      const data = await res.json();
      setSegmentos(data.segmentos || []);
      // CP-15: cargar totales globales si el endpoint los devuelve.
      if (
        typeof data.total_cartera === "number" &&
        typeof data.total_a_favor === "number" &&
        typeof data.total_neto === "number"
      ) {
        setTotales({
          bruto: data.total_cartera,
          a_favor: data.total_a_favor,
          neto: data.total_neto,
        });
      } else {
        setTotales(undefined);
      }
    } catch {
      setSegmentos([]);
      setTotales(undefined);
    } finally {
      setLoadingResumen(false);
    }
  }, []);

  const fetchCartera = useCallback(async (f: FiltrosCartera = {}) => {
    setLoadingFacturas(true);
    try {
      const params = new URLSearchParams();
      if (f.segmentos?.length) params.set("segmentos", f.segmentos.join(","));
      if (f.busqueda) params.set("busqueda", f.busqueda);
      if (f.vendedor) params.set("vendedor", f.vendedor);
      if (f.dias_min !== undefined) params.set("dias_min", String(f.dias_min));
      if (f.dias_max !== undefined) params.set("dias_max", String(f.dias_max));
      if (f.monto_min !== undefined) params.set("monto_min", String(f.monto_min));
      if (f.monto_max !== undefined) params.set("monto_max", String(f.monto_max));

      const res = await fetch(`/api/softec/cartera-vencida?${params.toString()}`);
      const data = await res.json();
      setFacturas(data.facturas || []);
      setSaldosClientes(data.saldos_clientes || {});
      setModo(data.modo || "mock");
      setUltimaConsulta(data.ultima_consulta || new Date().toISOString());

      // Extraer vendedores únicos
      const vends = [...new Set((data.facturas || []).map((f2: FacturaVencida) => f2.vendedor))].filter(Boolean);
      setVendedores(vends as string[]);
    } catch {
      setFacturas([]);
      setSaldosClientes({});
    } finally {
      setLoadingFacturas(false);
    }
  }, []);

  useEffect(() => {
    fetchResumen();
    fetchCartera();
  }, [fetchResumen, fetchCartera]);

  const handleFiltrar = (newFiltros: FiltrosCartera) => {
    setFiltros(newFiltros);
    setFiltroSegmentoCard(null);
    fetchCartera(newFiltros);
  };

  const handleLimpiar = () => {
    setFiltros({});
    setFiltroSegmentoCard(null);
    fetchCartera({});
  };

  const handleClickSegmento = (seg: SegmentoRiesgo) => {
    if (filtroSegmentoCard === seg) {
      // Toggle off
      setFiltroSegmentoCard(null);
      setFiltros((prev) => ({ ...prev, segmentos: undefined }));
      fetchCartera({ ...filtros, segmentos: undefined });
    } else {
      setFiltroSegmentoCard(seg);
      const newFiltros = { ...filtros, segmentos: [seg] };
      setFiltros(newFiltros);
      fetchCartera(newFiltros);
    }
  };

  const handleRefresh = () => {
    fetchResumen();
    fetchCartera(filtros);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Cartera Vencida
          </Title>
          <Space size={8} style={{ marginTop: 4 }}>
            {modo === "mock" && (
              <Tag color="orange">Modo Demo</Tag>
            )}
            {modo === "live" && (
              <Tag color="green">Datos en vivo</Tag>
            )}
            {ultimaConsulta && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <ClockCircleOutlined /> Última consulta: {formatFecha(ultimaConsulta)}
              </Text>
            )}
          </Space>
        </div>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={loadingFacturas}
        >
          Actualizar
        </Button>
      </div>

      {modo === "mock" && (
        <Alert
          message="Sin conexión a Softec"
          description="Mostrando datos de demostración. Configure las credenciales de Softec en .env.local para ver datos reales."
          type="info"
          showIcon
          closable
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Resumen por segmento (con totales CP-15 si hay anticipos) */}
      <ResumenCards
        segmentos={segmentos}
        loading={loadingResumen}
        filtroActivo={filtroSegmentoCard}
        onClickSegmento={handleClickSegmento}
        totales={totales}
      />

      {/* Filtros */}
      <div style={{ marginTop: 16 }}>
        <FiltrosCarteraComp
          filtros={filtros}
          vendedores={vendedores}
          onFiltrar={handleFiltrar}
          onLimpiar={handleLimpiar}
        />
      </div>

      {/* Tabla */}
      <TablaCartera
        facturas={facturas}
        loading={loadingFacturas}
        saldosClientes={saldosClientes}
      />
    </div>
  );
}
