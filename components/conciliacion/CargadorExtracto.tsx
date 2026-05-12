"use client";

import { useState } from "react";
import { Upload, Button, Select, Space, Card, Typography, message } from "antd";
import { InboxOutlined, CloudUploadOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd";

const { Dragger } = Upload;
const { Text } = Typography;

const BANCOS = [
  "Banreservas",
  "Banco Popular",
  "BHD León",
  "Scotiabank",
  "Banco BDI",
  "Banco Santa Cruz",
  "Banco López de Haro",
  "Banco Caribe",
  "Otro",
];

interface Props {
  onProcesar: (file: File, banco: string) => Promise<void>;
  loading: boolean;
}

export default function CargadorExtracto({ onProcesar, loading }: Props) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [banco, setBanco] = useState<string>("");
  const [messageApi, contextHolder] = message.useMessage();

  const handleProcesar = async () => {
    if (fileList.length === 0) {
      messageApi.warning("Seleccione un archivo");
      return;
    }
    if (!banco) {
      messageApi.warning("Seleccione el banco");
      return;
    }
    const file = fileList[0].originFileObj;
    if (!file) return;
    await onProcesar(file, banco);
    setFileList([]);
  };

  return (
    <>
      {contextHolder}
      <Card title="Cargar Extracto Bancario" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Select
            placeholder="Seleccione el banco"
            options={BANCOS.map((b) => ({ value: b, label: b }))}
            value={banco || undefined}
            onChange={setBanco}
            style={{ width: 300 }}
            size="large"
          />
          <Dragger
            accept=".xlsx,.xls,.csv,.txt"
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
            maxCount={1}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              Arrastre el extracto aquí o haga clic para seleccionar
            </p>
            <p className="ant-upload-hint">
              <Text type="secondary">Formatos: .xlsx, .xls, .csv, .txt</Text>
            </p>
          </Dragger>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={handleProcesar}
            loading={loading}
            disabled={fileList.length === 0 || !banco}
            size="large"
          >
            Procesar Extracto
          </Button>
        </Space>
      </Card>
    </>
  );
}
