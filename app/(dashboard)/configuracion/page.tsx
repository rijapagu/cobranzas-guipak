"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Card,
  Row,
  Col,
  Button,
  Space,
  Tag,
  Form,
  Input,
  message,
  Divider,
  Alert,
  Spin,
  Collapse,
} from "antd";
import {
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  DatabaseOutlined,
  MailOutlined,
  MessageOutlined,
  RobotOutlined,
  CloudOutlined,
  PlayCircleOutlined,
  SaveOutlined,
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

interface ConfigSeccion {
  configured: boolean;
  [key: string]: unknown;
}

interface ConfigState {
  softec: ConfigSeccion & {
    host: string;
    port: number;
    database: string;
    user: string;
    hasPassword: boolean;
  };
  smtp: ConfigSeccion & {
    host: string;
    port: number;
    user: string;
    from: string;
    hasPassword: boolean;
  };
  evolution: ConfigSeccion & {
    url: string;
    instance: string;
    hasApiKey: boolean;
  };
  claude: ConfigSeccion & {
    hasApiKey: boolean;
  };
  drive: ConfigSeccion & {
    hasClientId: boolean;
    hasClientSecret: boolean;
    folderId: string;
  };
}

interface TestResult {
  ok: boolean;
  mensaje: string;
  detalle?: Record<string, unknown>;
}

function StatusTag({ configured }: { configured: boolean }) {
  return configured ? (
    <Tag color="green" icon={<CheckCircleOutlined />}>Configurado</Tag>
  ) : (
    <Tag color="red" icon={<CloseCircleOutlined />}>No configurado</Tag>
  );
}

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const [promptAgente, setPromptAgente] = useState("");
  const [promptOriginal, setPromptOriginal] = useState("");
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  const [formSoftec] = Form.useForm();
  const [formSmtp] = Form.useForm();
  const [formEvolution] = Form.useForm();
  const [formClaude] = Form.useForm();
  const [formDrive] = Form.useForm();

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cobranzas/configuracion");
      if (res.status === 403) {
        message.error("Solo administradores pueden acceder a la configuración");
        return;
      }
      const data = await res.json();
      setConfig(data);

      // Pre-fill forms con valores actuales (sin passwords)
      formSoftec.setFieldsValue({
        host: data.softec.host,
        port: data.softec.port,
        database: data.softec.database,
        user: data.softec.user,
      });
      formSmtp.setFieldsValue({
        host: data.smtp.host,
        port: data.smtp.port,
        user: data.smtp.user,
        from: data.smtp.from,
      });
      formEvolution.setFieldsValue({
        url: data.evolution.url,
        instance: data.evolution.instance,
      });
      formDrive.setFieldsValue({
        folderId: data.drive.folderId,
      });
    } catch {
      message.error("Error cargando configuración");
    } finally {
      setLoading(false);
    }
  }, [formSoftec, formSmtp, formEvolution, formDrive]);

  const fetchPrompt = useCallback(async () => {
    setLoadingPrompt(true);
    try {
      const res = await fetch("/api/cobranzas/configuracion/prompt");
      const data = await res.json();
      if (data.prompt) {
        setPromptAgente(data.prompt);
        setPromptOriginal(data.prompt);
      }
    } catch { /* ignore */ }
    finally { setLoadingPrompt(false); }
  }, []);

  const guardarPrompt = async () => {
    if (!promptAgente.trim() || promptAgente.trim().length < 10) {
      message.warning("El prompt debe tener al menos 10 caracteres");
      return;
    }
    setSavingPrompt(true);
    try {
      const res = await fetch("/api/cobranzas/configuracion/prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptAgente }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success("Prompt del agente actualizado");
        setPromptOriginal(promptAgente);
      } else {
        message.error(data.error || "Error guardando");
      }
    } catch {
      message.error("Error de conexión");
    } finally {
      setSavingPrompt(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchPrompt();
  }, [fetchConfig, fetchPrompt]);

  const probarConexion = async (servicio: string) => {
    setTesting(servicio);
    setTestResults(prev => ({ ...prev, [servicio]: undefined as unknown as TestResult }));
    try {
      const res = await fetch("/api/cobranzas/configuracion/probar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servicio }),
      });
      const result: TestResult = await res.json();
      setTestResults(prev => ({ ...prev, [servicio]: result }));

      if (result.ok) {
        message.success(result.mensaje);
      } else {
        message.error(result.mensaje);
      }
    } catch {
      setTestResults(prev => ({
        ...prev,
        [servicio]: { ok: false, mensaje: "Error de conexión con la API" },
      }));
    } finally {
      setTesting(null);
    }
  };

  const guardarSeccion = async (seccion: string, valores: Record<string, string>) => {
    // Filtrar campos vacíos
    const valoresFiltrados = Object.fromEntries(
      Object.entries(valores).filter(([, v]) => v && v.trim())
    );

    if (Object.keys(valoresFiltrados).length === 0) {
      message.warning("No hay cambios que guardar");
      return;
    }

    setSaving(seccion);
    try {
      const res = await fetch("/api/cobranzas/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seccion, valores: valoresFiltrados }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success(`Configuración ${seccion} actualizada (${data.actualizadas.length} campos)`);
        fetchConfig();
      } else {
        message.error(data.error || "Error guardando");
      }
    } catch {
      message.error("Error de conexión");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" tip="Cargando configuración..." />
      </div>
    );
  }

  if (!config) {
    return <Alert message="No se pudo cargar la configuración" type="error" />;
  }

  const TestResultDisplay = ({ servicio }: { servicio: string }) => {
    const result = testResults[servicio];
    if (!result) return null;
    return (
      <Alert
        message={result.ok ? "Conexión exitosa" : "Error de conexión"}
        description={result.mensaje}
        type={result.ok ? "success" : "error"}
        showIcon
        style={{ marginTop: 12 }}
      />
    );
  };

  const items = [
    {
      key: "softec",
      label: (
        <Space>
          <DatabaseOutlined />
          <span>Softec MySQL (ERP)</span>
          <StatusTag configured={config.softec.configured} />
        </Space>
      ),
      children: (
        <div>
          <Paragraph type="secondary">
            Conexión de solo lectura al ERP Softec. Nunca se escriben datos aquí (CP-01).
          </Paragraph>
          <Form form={formSoftec} layout="vertical" onFinish={(v) => guardarSeccion("softec", v)}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="host" label="Host">
                  <Input placeholder="45.32.218.224" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="port" label="Puerto">
                  <Input placeholder="3306" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="database" label="Base de Datos">
                  <Input placeholder="guipak" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="user" label="Usuario">
                  <Input placeholder="softec" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="password" label="Contraseña">
                  <Input.Password placeholder={config.softec.hasPassword ? "••••••• (ya configurada)" : "Ingresar contraseña"} />
                </Form.Item>
              </Col>
            </Row>
            <Space>
              <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving === "softec"}>
                Guardar
              </Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => probarConexion("softec")} loading={testing === "softec"}>
                Probar Conexión
              </Button>
            </Space>
          </Form>
          <TestResultDisplay servicio="softec" />
        </div>
      ),
    },
    {
      key: "smtp",
      label: (
        <Space>
          <MailOutlined />
          <span>Email (SMTP)</span>
          <StatusTag configured={config.smtp.configured} />
        </Space>
      ),
      children: (
        <div>
          <Paragraph type="secondary">
            Servidor SMTP para envío de emails de cobranza.
          </Paragraph>
          <Form form={formSmtp} layout="vertical" onFinish={(v) => guardarSeccion("smtp", v)}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="host" label="Host SMTP">
                  <Input placeholder="mail.guipak.com" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="port" label="Puerto">
                  <Input placeholder="465" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="from" label="Email Remitente">
                  <Input placeholder="cobros@guipak.com" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="user" label="Usuario">
                  <Input placeholder="cobros@guipak.com" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="password" label="Contraseña">
                  <Input.Password placeholder={config.smtp.hasPassword ? "••••••• (ya configurada)" : "Ingresar contraseña"} />
                </Form.Item>
              </Col>
            </Row>
            <Space>
              <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving === "smtp"}>
                Guardar
              </Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => probarConexion("smtp")} loading={testing === "smtp"}>
                Probar Conexión
              </Button>
            </Space>
          </Form>
          <TestResultDisplay servicio="smtp" />
        </div>
      ),
    },
    {
      key: "evolution",
      label: (
        <Space>
          <MessageOutlined />
          <span>WhatsApp (Evolution API)</span>
          <StatusTag configured={config.evolution.configured} />
        </Space>
      ),
      children: (
        <div>
          <Paragraph type="secondary">
            Integración con Evolution API para envío y recepción de WhatsApp.
          </Paragraph>
          <Form form={formEvolution} layout="vertical" onFinish={(v) => guardarSeccion("evolution", v)}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="url" label="URL de Evolution API">
                  <Input placeholder="https://evolution.tudominio.com" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="instance" label="Nombre de Instancia">
                  <Input placeholder="guipak-cobros" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="apiKey" label="API Key">
              <Input.Password placeholder={config.evolution.hasApiKey ? "••••••• (ya configurada)" : "Ingresar API Key"} />
            </Form.Item>
            <Space>
              <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving === "evolution"}>
                Guardar
              </Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => probarConexion("evolution")} loading={testing === "evolution"}>
                Probar Conexión
              </Button>
            </Space>
          </Form>
          <TestResultDisplay servicio="evolution" />
        </div>
      ),
    },
    {
      key: "claude",
      label: (
        <Space>
          <RobotOutlined />
          <span>Claude AI (Anthropic)</span>
          <StatusTag configured={config.claude.configured} />
        </Space>
      ),
      children: (
        <div>
          <Paragraph type="secondary">
            API de Claude AI para generación de mensajes y análisis de respuestas.
            Obtén tu API key en{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
              console.anthropic.com/settings/keys
            </a>
          </Paragraph>
          <Form form={formClaude} layout="vertical" onFinish={(v) => guardarSeccion("claude", v)}>
            <Form.Item name="apiKey" label="API Key">
              <Input.Password placeholder={config.claude.hasApiKey ? "sk-ant-••••••• (ya configurada)" : "sk-ant-..."} />
            </Form.Item>
            <Space>
              <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving === "claude"}>
                Guardar
              </Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => probarConexion("claude")} loading={testing === "claude"}>
                Probar API Key
              </Button>
            </Space>
          </Form>
          <TestResultDisplay servicio="claude" />
        </div>
      ),
    },
    {
      key: "prompt",
      label: (
        <Space>
          <RobotOutlined />
          <span>Prompt del Agente (IA)</span>
          {promptOriginal ? (
            <Tag color="green" icon={<CheckCircleOutlined />}>Personalizado</Tag>
          ) : (
            <Tag color="default">Por defecto</Tag>
          )}
        </Space>
      ),
      children: (
        <div>
          <Paragraph type="secondary">
            Instrucciones que recibe el agente IA al procesar cada mensaje. Define su personalidad,
            reglas de negocio y comportamiento. Si se deja vacío, usa el prompt predeterminado del sistema.
          </Paragraph>
          {loadingPrompt ? (
            <div style={{ textAlign: "center", padding: 24 }}>
              <Spin size="small" />
            </div>
          ) : (
            <>
              <Input.TextArea
                value={promptAgente}
                onChange={(e) => setPromptAgente(e.target.value)}
                rows={16}
                placeholder="Escribe aquí las instrucciones del agente... (deja vacío para usar el prompt predeterminado)"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
              <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {promptAgente.length.toLocaleString()} caracteres
                  {promptAgente !== promptOriginal && " · Sin guardar"}
                </Text>
                <Space>
                  {promptOriginal && (
                    <Button
                      size="small"
                      danger
                      onClick={() => {
                        setPromptAgente("");
                        setSavingPrompt(true);
                        fetch("/api/cobranzas/configuracion/prompt", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ prompt: "          " }),
                        }).then(() => {
                          setPromptOriginal("");
                          message.info("Prompt reseteado al predeterminado");
                        }).finally(() => setSavingPrompt(false));
                      }}
                    >
                      Resetear a predeterminado
                    </Button>
                  )}
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={savingPrompt}
                    disabled={!promptAgente.trim() || promptAgente === promptOriginal}
                    onClick={guardarPrompt}
                  >
                    Guardar Prompt
                  </Button>
                </Space>
              </div>
            </>
          )}
        </div>
      ),
    },
    {
      key: "drive",
      label: (
        <Space>
          <CloudOutlined />
          <span>Google Drive</span>
          <StatusTag configured={config.drive.configured} />
        </Space>
      ),
      children: (
        <div>
          <Paragraph type="secondary">
            Google Drive API para almacenar y servir PDFs de facturas escaneadas.
            El CRM envía facturas escaneadas vía webhook y se vinculan automáticamente.
          </Paragraph>
          <Form form={formDrive} layout="vertical" onFinish={(v) => guardarSeccion("drive", v)}>
            <Form.Item name="clientId" label="Client ID">
              <Input placeholder={config.drive.hasClientId ? "••••••• (ya configurado)" : "Google OAuth Client ID"} />
            </Form.Item>
            <Form.Item name="clientSecret" label="Client Secret">
              <Input.Password placeholder={config.drive.hasClientSecret ? "••••••• (ya configurado)" : "Client Secret"} />
            </Form.Item>
            <Form.Item name="refreshToken" label="Refresh Token">
              <Input.Password placeholder="Refresh Token OAuth" />
            </Form.Item>
            <Form.Item name="folderId" label="Folder ID (carpeta de facturas)">
              <Input placeholder="ID de la carpeta en Google Drive" />
            </Form.Item>
            <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving === "drive"}>
              Guardar
            </Button>
          </Form>
        </div>
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>
        <SettingOutlined /> Configuración del Sistema
      </Title>

      <Alert
        message="Cambios en runtime"
        description="Los cambios aquí aplican inmediatamente, pero se pierden al reiniciar el servidor. Para que persistan, configúrelos también como variables de entorno en Dokploy."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Collapse items={items} defaultActiveKey={["softec"]} />
    </div>
  );
}
