"use client";

/**
 * Configuración de la empresa (Fase 3 Etapa 3 — tenants).
 * Identidad para los mensajes de IA + SMTP + WhatsApp (Evolution).
 * Guipak (empresa 1) ve esta página en modo lectura: sus credenciales se
 * gestionan por variables de entorno del servidor.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Typography,
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Alert,
  Tag,
  message,
  Divider,
} from "antd";
import {
  IdcardOutlined,
  MailOutlined,
  WhatsAppOutlined,
  SaveOutlined,
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

interface ConfigUi {
  identidad: { nombre: string; alias: string; firma: string };
  smtp: { host: string; port: number; user: string; from: string; nombreRemitente: string; hasPassword: boolean } | null;
  evolution: { url: string; instance: string; hasApikey: boolean } | null;
  gestionadaPorServidor: boolean;
}

export default function ConfiguracionEmpresaPage() {
  const [config, setConfig] = useState<ConfigUi | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [form] = Form.useForm();

  const cargar = useCallback(async () => {
    const r = await fetch("/api/cobranzas/configuracion/empresa");
    if (!r.ok) return;
    const c: ConfigUi = await r.json();
    setConfig(c);
    form.setFieldsValue({
      identidad_nombre: c.identidad.nombre,
      identidad_alias: c.identidad.alias,
      identidad_firma: c.identidad.firma,
      smtp_host: c.smtp?.host,
      smtp_port: c.smtp?.port ?? 465,
      smtp_user: c.smtp?.user,
      smtp_from: c.smtp?.from,
      smtp_nombre: c.smtp?.nombreRemitente,
      evo_url: c.evolution?.url,
      evo_instance: c.evolution?.instance,
    });
  }, [form]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async () => {
    const v = form.getFieldsValue();
    setGuardando(true);
    try {
      const body: Record<string, unknown> = {
        identidad: {
          nombre: v.identidad_nombre,
          alias: v.identidad_alias,
          firma: v.identidad_firma,
        },
      };
      if (v.smtp_host && v.smtp_user) {
        body.smtp = {
          host: v.smtp_host,
          port: Number(v.smtp_port) || 465,
          user: v.smtp_user,
          pass: v.smtp_pass || undefined,
          from: v.smtp_from || undefined,
          nombreRemitente: v.smtp_nombre || undefined,
        };
      }
      if (v.evo_url && v.evo_instance) {
        body.evolution = {
          url: v.evo_url,
          apikey: v.evo_apikey || undefined,
          instance: v.evo_instance,
        };
      }
      const r = await fetch("/api/cobranzas/configuracion/empresa", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok) {
        message.success("Configuración guardada");
        form.setFieldsValue({ smtp_pass: "", evo_apikey: "" });
        setConfig(j.config);
      } else {
        message.error(j.error || "Error guardando");
      }
    } finally {
      setGuardando(false);
    }
  };

  if (!config) return null;

  return (
    <div style={{ maxWidth: 760 }}>
      <Title level={3}>
        <IdcardOutlined /> Mi empresa
      </Title>
      <Paragraph type="secondary">
        Identidad con la que se firman los mensajes y canales de envío propios
        de tu empresa.
      </Paragraph>

      {config.gestionadaPorServidor && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Configuración gestionada en el servidor"
          description="Las credenciales de esta empresa se administran por variables de entorno. Esta página es solo informativa."
        />
      )}

      <Form form={form} layout="vertical" disabled={config.gestionadaPorServidor}>
        <Card title="Identidad en los mensajes" style={{ marginBottom: 16 }}>
          <Form.Item name="identidad_nombre" label="Nombre legal / comercial" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="Mi Empresa, S.R.L." />
          </Form.Item>
          <Form.Item name="identidad_alias" label="Alias corto (firma de WhatsApp)" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="Mi Empresa" />
          </Form.Item>
          <Form.Item name="identidad_firma" label="Firma de los correos" rules={[{ required: true, min: 2 }]}>
            <Input.TextArea rows={2} placeholder={"Departamento de Cobranzas\nMi Empresa, S.R.L."} />
          </Form.Item>
        </Card>

        <Card
          title={<><MailOutlined /> Email (SMTP) {config.smtp?.hasPassword && <Tag color="green">configurado</Tag>}</>}
          style={{ marginBottom: 16 }}
        >
          <Space.Compact block>
            <Form.Item name="smtp_host" label="Host" style={{ flex: 2, marginRight: 8 }}>
              <Input placeholder="mail.miempresa.com" />
            </Form.Item>
            <Form.Item name="smtp_port" label="Puerto" style={{ flex: 1 }}>
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="smtp_user" label="Usuario">
            <Input placeholder="cobros@miempresa.com" />
          </Form.Item>
          <Form.Item
            name="smtp_pass"
            label="Contraseña"
            extra={config.smtp?.hasPassword ? "Dejar vacía para conservar la actual." : undefined}
          >
            <Input.Password placeholder={config.smtp?.hasPassword ? "••••••••" : ""} />
          </Form.Item>
          <Form.Item name="smtp_from" label="Remitente (from)">
            <Input placeholder="cobros@miempresa.com" />
          </Form.Item>
          <Form.Item name="smtp_nombre" label="Nombre del remitente">
            <Input placeholder="Cobros Mi Empresa" />
          </Form.Item>
        </Card>

        <Card
          title={<><WhatsAppOutlined /> WhatsApp (Evolution API) {config.evolution?.hasApikey && <Tag color="green">configurado</Tag>}</>}
          style={{ marginBottom: 16 }}
        >
          <Form.Item name="evo_url" label="URL de Evolution API">
            <Input placeholder="https://evolution.miempresa.com" />
          </Form.Item>
          <Form.Item name="evo_instance" label="Instancia">
            <Input placeholder="MiEmpresa" />
          </Form.Item>
          <Form.Item
            name="evo_apikey"
            label="API Key"
            extra={config.evolution?.hasApikey ? "Dejar vacía para conservar la actual." : undefined}
          >
            <Input.Password placeholder={config.evolution?.hasApikey ? "••••••••" : ""} />
          </Form.Item>
        </Card>

        <Divider />
        <Button type="primary" icon={<SaveOutlined />} loading={guardando} onClick={guardar}>
          Guardar configuración
        </Button>
        <Text type="secondary" style={{ marginLeft: 12 }}>
          La cartera se importa en <a href="/configuracion/importar-cartera">Importar cartera</a>.
        </Text>
      </Form>
    </div>
  );
}
