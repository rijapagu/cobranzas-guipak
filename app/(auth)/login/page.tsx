"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Form, Input, Button, Typography, Alert, Space, Spin } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al iniciar sesión");
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ width: 400, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
      <Space
        orientation="vertical"
        size="large"
        style={{ width: "100%", textAlign: "center" }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Cobranzas Guipak
          </Title>
          <Text type="secondary">Suministros Guipak, S.R.L.</Text>
        </div>

        {error && (
          <Alert message={error} type="error" showIcon closable />
        )}

        <Form
          name="login"
          onFinish={onFinish}
          layout="vertical"
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: "Ingrese su email" },
              { type: "email", message: "Email inválido" },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="Email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: "Ingrese su contraseña" },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Contraseña"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              Iniciar Sesión
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0f2f5",
      }}
    >
      <Suspense fallback={<Spin size="large" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
