"use client";

/**
 * Importación de cartera por CSV (Fase 3 Etapa 2 — empresas en modo CSV).
 * Sube el snapshot de facturas pendientes (+ clientes opcional) y REEMPLAZA
 * la cartera importada de la empresa. Guipak (Softec en vivo) no usa esto.
 */

import { useState } from "react";
import {
  Typography,
  Card,
  Button,
  Upload,
  Alert,
  Space,
  Result,
  Divider,
  List,
} from "antd";
import {
  UploadOutlined,
  FileExcelOutlined,
  CloudUploadOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd";

const { Title, Text, Paragraph } = Typography;

interface RespuestaImport {
  ok?: boolean;
  error?: string;
  facturas_importadas?: number;
  clientes_importados?: number;
  filas_descartadas?: number;
  errores?: string[];
}

export default function ImportarCarteraPage() {
  const [facturas, setFacturas] = useState<UploadFile[]>([]);
  const [clientes, setClientes] = useState<UploadFile[]>([]);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<RespuestaImport | null>(null);

  const importar = async () => {
    const archivoFacturas = facturas[0]?.originFileObj;
    if (!archivoFacturas) return;
    setCargando(true);
    setResultado(null);
    try {
      const form = new FormData();
      form.append("facturas", archivoFacturas);
      const archivoClientes = clientes[0]?.originFileObj;
      if (archivoClientes) form.append("clientes", archivoClientes);
      const res = await fetch("/api/erp/importar-cartera", {
        method: "POST",
        body: form,
      });
      setResultado(await res.json());
    } catch {
      setResultado({ error: "Error de red al importar" });
    } finally {
      setCargando(false);
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <Title level={3}>
        <CloudUploadOutlined /> Importar cartera (CSV)
      </Title>
      <Paragraph type="secondary">
        Para empresas sin ERP conectado: sube el snapshot de tus facturas
        pendientes. Cada importación <Text strong>reemplaza por completo</Text>{" "}
        la cartera anterior. El archivo de clientes es opcional — si no lo
        subes, los clientes se derivan de la columna{" "}
        <Text code>nombre_cliente</Text> de las facturas.
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Formato esperado"
        description={
          <>
            <Paragraph style={{ marginBottom: 4 }}>
              <Text strong>facturas.csv</Text> — columnas requeridas:{" "}
              <Text code>numero, codigo_cliente, total, saldo_pendiente, fecha_vencimiento</Text>
              {" "}(opcionales: <Text code>nombre_cliente, ncf, moneda, fecha_emision</Text>)
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text strong>clientes.csv</Text> — columnas requeridas:{" "}
              <Text code>codigo, nombre</Text>
              {" "}(opcionales: <Text code>rnc, email, telefono, telefono2, contacto_cobros, vendedor</Text>).
              Fechas en <Text code>AAAA-MM-DD</Text> o <Text code>DD/MM/AAAA</Text>.
            </Paragraph>
          </>
        }
      />

      <Card>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <Text strong>Facturas pendientes (requerido)</Text>
            <Upload
              accept=".csv,text/csv"
              maxCount={1}
              fileList={facturas}
              beforeUpload={() => false}
              onChange={({ fileList }) => setFacturas(fileList)}
            >
              <Button icon={<UploadOutlined />}>Seleccionar facturas.csv</Button>
            </Upload>
          </div>
          <div>
            <Text strong>Clientes (opcional)</Text>
            <Upload
              accept=".csv,text/csv"
              maxCount={1}
              fileList={clientes}
              beforeUpload={() => false}
              onChange={({ fileList }) => setClientes(fileList)}
            >
              <Button icon={<UploadOutlined />}>Seleccionar clientes.csv</Button>
            </Upload>
          </div>
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            loading={cargando}
            disabled={facturas.length === 0}
            onClick={importar}
          >
            Importar (reemplaza la cartera actual)
          </Button>
        </Space>
      </Card>

      {resultado && (
        <>
          <Divider />
          {resultado.ok ? (
            <Result
              status="success"
              title={`Cartera importada: ${resultado.facturas_importadas} facturas, ${resultado.clientes_importados} clientes`}
              subTitle={
                resultado.filas_descartadas
                  ? `${resultado.filas_descartadas} fila(s) descartadas por errores`
                  : "Sin filas descartadas"
              }
            />
          ) : (
            <Alert
              type="error"
              showIcon
              message={resultado.error || "Error importando"}
            />
          )}
          {resultado.errores && resultado.errores.length > 0 && (
            <List
              size="small"
              header={<Text strong>Detalle de filas con error</Text>}
              bordered
              dataSource={resultado.errores}
              renderItem={(e) => <List.Item>{e}</List.Item>}
              style={{ marginTop: 12 }}
            />
          )}
        </>
      )}
    </div>
  );
}
