"use client";

import { useCallback, useEffect, useState } from "react";
import { Typography, message, Alert, Button, Popconfirm, Space, Dropdown } from "antd";
import { DeleteOutlined, FileTextOutlined, DownOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import type { ConciliacionEntry, ClienteOption } from "@/lib/types/conciliacion";
import CargadorExtracto from "@/components/conciliacion/CargadorExtracto";
import ResumenConciliacion from "@/components/conciliacion/ResumenConciliacion";
import TablaConciliacion from "@/components/conciliacion/TablaConciliacion";
import { getMockClientes } from "@/lib/mock/conciliacion-mock";

const { Title } = Typography;

export default function ConciliacionPage() {
  const [entradas, setEntradas] = useState<ConciliacionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [clientes] = useState<ClienteOption[]>(getMockClientes());
  const [limpiando, setLimpiando] = useState(false);
  const [archivoAEliminar, setArchivoAEliminar] = useState<string | null>(null);
  const [archivosCargados, setArchivosCargados] = useState<{ archivo_origen: string; fecha_extracto: string; registros: number }[]>([]);
  const [stats, setStats] = useState({
    conciliadas: 0,
    por_aplicar: 0,
    desconocidas: 0,
    cheques_devueltos: 0,
    monto_conciliado: 0,
    monto_por_aplicar: 0,
    monto_desconocido: 0,
    monto_devuelto: 0,
  });
  const [messageApi, contextHolder] = message.useMessage();

  const fetchResultados = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/conciliacion/resultados");
      const data = await res.json();
      setEntradas(data.entradas || []);
      setArchivosCargados(data.archivos || []);
      setStats({
        conciliadas: data.conciliadas || 0,
        por_aplicar: data.por_aplicar || 0,
        desconocidas: data.desconocidas || 0,
        cheques_devueltos: data.cheques_devueltos || 0,
        monto_conciliado: data.monto_conciliado || 0,
        monto_por_aplicar: data.monto_por_aplicar || 0,
        monto_desconocido: data.monto_desconocido || 0,
        monto_devuelto: data.monto_devuelto || 0,
      });
    } catch {
      setEntradas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResultados();
  }, [fetchResultados]);

  const handleProcesar = async (file: File, banco: string) => {
    setCargando(true);
    try {
      const formData = new FormData();
      formData.append("archivo", file);
      formData.append("banco", banco);

      const res = await fetch("/api/conciliacion/cargar", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        messageApi.error(data.error || "Error procesando");
        return;
      }

      const parts = [`${data.conciliadas} conciliadas`, `${data.por_aplicar} por aplicar`, `${data.desconocidas} desconocidas`];
      if (data.cheques_devueltos > 0) parts.push(`${data.cheques_devueltos} cheques devueltos`);
      messageApi.success(`Procesado: ${parts.join(', ')}`);
      fetchResultados();
    } catch {
      messageApi.error("Error de conexión");
    } finally {
      setCargando(false);
    }
  };

  const handleLimpiar = async (archivo: string) => {
    setLimpiando(true);
    try {
      const res = await fetch(`/api/conciliacion/resultados?archivo=${encodeURIComponent(archivo)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        messageApi.error(data.error || "Error limpiando");
        return;
      }
      messageApi.success(`${data.total} registros de "${archivo}" eliminados`);
      setArchivoAEliminar(null);
      fetchResultados();
    } catch {
      messageApi.error("Error de conexión");
    } finally {
      setLimpiando(false);
    }
  };

  const menuArchivos: MenuProps["items"] = archivosCargados.map((a) => ({
    key: a.archivo_origen,
    icon: <FileTextOutlined />,
    label: `${a.archivo_origen} (${a.registros} reg, ${a.fecha_extracto})`,
    onClick: () => setArchivoAEliminar(a.archivo_origen),
  }));

  return (
    <div>
      {contextHolder}

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Conciliación Bancaria
        </Title>
        {archivosCargados.length > 0 && (
          <Dropdown menu={{ items: menuArchivos }} trigger={["click"]}>
            <Button icon={<DeleteOutlined />}>
              Eliminar carga <DownOutlined />
            </Button>
          </Dropdown>
        )}
      </Space>

      <Popconfirm
        title={`¿Eliminar registros de "${archivoAEliminar}"?`}
        description="Solo se eliminarán los registros de este archivo. Las demás cargas no se afectan."
        open={!!archivoAEliminar}
        onConfirm={() => archivoAEliminar && handleLimpiar(archivoAEliminar)}
        onCancel={() => setArchivoAEliminar(null)}
        okText="Sí, eliminar"
        cancelText="Cancelar"
        okButtonProps={{ danger: true, loading: limpiando }}
      >
        <span />
      </Popconfirm>

      <Alert
        message="Conciliación inteligente"
        description="El sistema aprende a identificar cuentas bancarias de clientes. La primera vez que aparece una cuenta nueva, debe asignarla manualmente. En futuras cargas, el sistema la propondrá automáticamente."
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />

      {/* Cargador */}
      <CargadorExtracto onProcesar={handleProcesar} loading={cargando} />

      {/* Resumen */}
      {(stats.conciliadas > 0 || stats.por_aplicar > 0 || stats.desconocidas > 0 || stats.cheques_devueltos > 0) && (
        <ResumenConciliacion {...stats} />
      )}

      {/* Tabla de resultados */}
      {entradas.length > 0 && (
        <TablaConciliacion
          entradas={entradas}
          loading={loading}
          clientes={clientes}
          onRefresh={fetchResultados}
        />
      )}
    </div>
  );
}
