"use client";

import { Form, Input, Select, InputNumber, Button, Space, Card } from "antd";
import { SearchOutlined, ClearOutlined } from "@ant-design/icons";
import type { FiltrosCartera, SegmentoRiesgo } from "@/lib/types/cartera";

interface Props {
  filtros: FiltrosCartera;
  vendedores: string[];
  onFiltrar: (filtros: FiltrosCartera) => void;
  onLimpiar: () => void;
}

const segmentoOptions = [
  { value: "ROJO" as SegmentoRiesgo, label: "\uD83D\uDD34 Rojo (30+)" },
  { value: "NARANJA" as SegmentoRiesgo, label: "\uD83D\uDFE0 Naranja (16-30)" },
  { value: "AMARILLO" as SegmentoRiesgo, label: "\uD83D\uDFE1 Amarillo (1-15)" },
  { value: "VERDE" as SegmentoRiesgo, label: "\uD83D\uDFE2 Verde" },
];

export default function FiltrosCartera({ filtros, vendedores, onFiltrar, onLimpiar }: Props) {
  const [form] = Form.useForm();

  const handleFinish = (values: Record<string, unknown>) => {
    onFiltrar({
      segmentos: values.segmentos as SegmentoRiesgo[] | undefined,
      busqueda: values.busqueda as string | undefined,
      vendedor: values.vendedor as string | undefined,
      dias_min: values.dias_min as number | undefined,
      dias_max: values.dias_max as number | undefined,
      monto_min: values.monto_min as number | undefined,
      monto_max: values.monto_max as number | undefined,
    });
  };

  const handleLimpiar = () => {
    form.resetFields();
    onLimpiar();
  };

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Form
        form={form}
        layout="inline"
        onFinish={handleFinish}
        initialValues={filtros}
        style={{ flexWrap: "wrap", gap: 8 }}
      >
        <Form.Item name="busqueda" style={{ minWidth: 200 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Buscar cliente, c\u00f3digo o NCF"
            allowClear
            onChange={(e) => {
              if (!e.target.value) form.submit();
            }}
          />
        </Form.Item>
        <Form.Item name="segmentos">
          <Select
            mode="multiple"
            placeholder="Segmento"
            options={segmentoOptions}
            style={{ minWidth: 180 }}
            allowClear
            onChange={() => form.submit()}
          />
        </Form.Item>
        <Form.Item name="vendedor">
          <Select
            placeholder="Vendedor"
            options={vendedores.map((v) => ({ value: v, label: v }))}
            style={{ minWidth: 120 }}
            allowClear
            onChange={() => form.submit()}
          />
        </Form.Item>
        <Form.Item name="dias_min">
          <InputNumber placeholder="D\u00edas m\u00edn" min={0} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="dias_max">
          <InputNumber placeholder="D\u00edas m\u00e1x" min={0} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="monto_min">
          <InputNumber placeholder="Monto m\u00edn" min={0} style={{ width: 130 }} />
        </Form.Item>
        <Form.Item name="monto_max">
          <InputNumber placeholder="Monto m\u00e1x" min={0} style={{ width: 130 }} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
              Filtrar
            </Button>
            <Button onClick={handleLimpiar} icon={<ClearOutlined />}>
              Limpiar
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
