"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Table,
  Button,
  Space,
  Tag,
  Drawer,
  Form,
  Input,
  Select,
  Switch,
  message,
  Alert,
  Popconfirm,
  Tooltip,
  Divider,
} from "antd";
import {
  UserAddOutlined,
  EditOutlined,
  StopOutlined,
  KeyOutlined,
  TeamOutlined,
  SendOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Title, Text, Paragraph } = Typography;

type Rol = "ADMIN" | "SUPERVISOR" | "COBRADOR";

interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  activo: number;
  ultimo_login: string | null;
  created_at: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  telegram_rol: "supervisor" | "agente_cobros" | null;
}

const ROL_COLOR: Record<Rol, string> = {
  ADMIN: "purple",
  SUPERVISOR: "blue",
  COBRADOR: "default",
};

const ROL_DESCRIPCION: Record<Rol, string> = {
  ADMIN: "Todo lo del supervisor, y además configura el sistema y gestiona usuarios.",
  SUPERVISOR: "Aprueba, descarta y envía gestiones de cobro. Edita plantillas y cadencias.",
  COBRADOR: "Consulta la cartera y trabaja tareas. No puede aprobar cobros.",
};

function fecha(valor: string | null): string {
  if (!valor) return "—";
  return new Date(valor).toLocaleString("es-DO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [yoId, setYoId] = useState<number | null>(null);
  const [form] = Form.useForm();

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cobranzas/usuarios");
      if (res.status === 403) {
        setSinPermiso(true);
        setUsuarios([]);
        return;
      }
      const data = await res.json();
      setUsuarios(data.usuarios || []);
    } catch {
      message.error("Error cargando los usuarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setYoId(d?.user?.userId ?? null))
      .catch(() => {});
  }, [cargar]);

  const abrirNuevo = () => {
    setEditando(null);
    form.resetFields();
    form.setFieldsValue({ rol: "COBRADOR", activo: true });
    setDrawerOpen(true);
  };

  const abrirEdicion = (u: Usuario) => {
    setEditando(u);
    form.resetFields();
    form.setFieldsValue({
      email: u.email,
      nombre: u.nombre,
      rol: u.rol,
      activo: u.activo === 1,
      password: "",
      telegram_user_id: u.telegram_user_id ?? undefined,
      telegram_username: u.telegram_username ?? undefined,
    });
    setDrawerOpen(true);
  };

  const guardar = async () => {
    let valores;
    try {
      valores = await form.validateFields();
    } catch {
      return;
    }

    setGuardando(true);
    try {
      const esNuevo = editando === null;
      const url = esNuevo
        ? "/api/cobranzas/usuarios"
        : `/api/cobranzas/usuarios/${editando.id}`;

      // Vacío significa "sin Telegram": al editar eso quita el vínculo, así que
      // se manda null explícito en vez de omitir el campo.
      const telegramId = valores.telegram_user_id
        ? Number(valores.telegram_user_id)
        : null;

      // En edición, la contraseña solo viaja si el admin escribió una nueva.
      const cuerpo: Record<string, unknown> = esNuevo
        ? {
            email: valores.email,
            nombre: valores.nombre,
            password: valores.password,
            rol: valores.rol,
            activo: valores.activo,
            telegram_user_id: telegramId,
            telegram_username: valores.telegram_username || null,
          }
        : {
            nombre: valores.nombre,
            rol: valores.rol,
            activo: valores.activo,
            telegram_user_id: telegramId,
            telegram_username: valores.telegram_username || null,
            ...(valores.password ? { password: valores.password } : {}),
          };

      const res = await fetch(url, {
        method: esNuevo ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json();

      if (!res.ok) {
        message.error(data.error || "No se pudo guardar");
        return;
      }

      if (data.aviso) {
        message.warning(data.aviso, 8);
      } else {
        message.success(esNuevo ? "Usuario creado" : "Usuario actualizado");
      }
      setDrawerOpen(false);
      cargar();
    } catch {
      message.error("Error guardando el usuario");
    } finally {
      setGuardando(false);
    }
  };

  const desactivar = async (u: Usuario) => {
    try {
      const res = await fetch(`/api/cobranzas/usuarios/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.error || "No se pudo desactivar");
        return;
      }
      message.success(`${u.nombre} ya no tiene acceso`);
      cargar();
    } catch {
      message.error("Error desactivando el usuario");
    }
  };

  const columnas: ColumnsType<Usuario> = [
    {
      title: "Nombre",
      dataIndex: "nombre",
      key: "nombre",
      render: (nombre: string, u) => (
        <Space direction="vertical" size={0}>
          <Text strong={u.activo === 1}>{nombre}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {u.email}
          </Text>
        </Space>
      ),
    },
    {
      title: "Rol",
      dataIndex: "rol",
      key: "rol",
      width: 140,
      render: (rol: Rol) => (
        <Tooltip title={ROL_DESCRIPCION[rol]}>
          <Tag color={ROL_COLOR[rol]}>{rol}</Tag>
        </Tooltip>
      ),
    },
    {
      title: "Estado",
      dataIndex: "activo",
      key: "activo",
      width: 110,
      render: (activo: number) =>
        activo === 1 ? <Tag color="green">Activo</Tag> : <Tag>Sin acceso</Tag>,
    },
    {
      title: "Telegram",
      key: "telegram",
      width: 150,
      render: (_, u) =>
        u.telegram_user_id ? (
          <Tooltip title={`id ${u.telegram_user_id} · rol ${u.telegram_rol}`}>
            <Tag color="cyan">
              {u.telegram_username ? `@${u.telegram_username}` : "Vinculado"}
            </Tag>
          </Tooltip>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Sin vincular
          </Text>
        ),
    },
    {
      title: "Último acceso",
      dataIndex: "ultimo_login",
      key: "ultimo_login",
      width: 170,
      render: (v: string | null) => <Text type="secondary">{fecha(v)}</Text>,
    },
    {
      title: "Acciones",
      key: "acciones",
      width: 190,
      render: (_, u) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => abrirEdicion(u)}>
            Editar
          </Button>
          {u.activo === 1 && u.id !== yoId && (
            <Popconfirm
              title="Quitarle el acceso"
              description={`${u.nombre} no podrá volver a entrar. Su historial se conserva.`}
              okText="Quitar acceso"
              cancelText="Cancelar"
              onConfirm={() => desactivar(u)}
            >
              <Button size="small" danger icon={<StopOutlined />}>
                Quitar
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (sinPermiso) {
    return (
      <>
        <Title level={3}>
          <TeamOutlined /> Usuarios
        </Title>
        <Alert
          type="warning"
          showIcon
          message="Necesitas ser administrador"
          description="Crear usuarios es repartir acceso al sistema, así que está reservado al rol ADMIN. Pídeselo a un administrador."
        />
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            <TeamOutlined /> Usuarios
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 620 }}>
            Quién puede entrar al sistema y qué puede hacer. Al quitar el acceso el usuario no
            se borra: su historial de aprobaciones tiene que seguir teniendo dueño.
          </Paragraph>
        </div>
        <Button type="primary" icon={<UserAddOutlined />} onClick={abrirNuevo}>
          Nuevo usuario
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columnas}
        dataSource={usuarios}
        loading={loading}
        pagination={false}
      />

      <Drawer
        title={editando ? `Editar a ${editando.nombre}` : "Nuevo usuario"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={460}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>Cancelar</Button>
            <Button type="primary" loading={guardando} onClick={guardar}>
              Guardar
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="email"
            label="Correo"
            rules={[
              { required: true, message: "El correo es obligatorio" },
              { type: "email", message: "No parece un correo válido" },
            ]}
          >
            <Input
              placeholder="nombre@guipak.com"
              disabled={editando !== null}
              autoComplete="off"
            />
          </Form.Item>
          {editando && (
            <Text type="secondary" style={{ display: "block", marginTop: -16, marginBottom: 16, fontSize: 12 }}>
              El correo no se cambia: es con lo que entra y con lo que quedó firmado su historial.
            </Text>
          )}

          <Form.Item
            name="nombre"
            label="Nombre"
            rules={[{ required: true, min: 2, message: "Escribe el nombre" }]}
          >
            <Input placeholder="Nombre y apellido" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="password"
            label={editando ? "Nueva contraseña (opcional)" : "Contraseña"}
            rules={
              editando
                ? [{ min: 10, message: "Mínimo 10 caracteres" }]
                : [{ required: true, min: 10, message: "Mínimo 10 caracteres" }]
            }
            extra={
              editando
                ? "Déjalo vacío para no cambiarla."
                : "Mínimo 10 caracteres. Dísela por un canal aparte, no por correo junto con el usuario."
            }
          >
            <Input.Password
              prefix={<KeyOutlined />}
              placeholder={editando ? "Sin cambios" : "Mínimo 10 caracteres"}
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item name="rol" label="Rol" rules={[{ required: true }]}>
            <Select
              options={(["COBRADOR", "SUPERVISOR", "ADMIN"] as Rol[]).map((r) => ({
                value: r,
                label: r,
              }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.rol !== cur.rol}>
            {({ getFieldValue }) => {
              const rol = (getFieldValue("rol") || "COBRADOR") as Rol;
              return (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: -12, marginBottom: 16 }}
                  message={ROL_DESCRIPCION[rol]}
                />
              );
            }}
          </Form.Item>

          <Form.Item name="activo" label="Puede entrar" valuePropName="checked">
            <Switch checkedChildren="Sí" unCheckedChildren="No" />
          </Form.Item>

          <Divider style={{ marginTop: 8 }}>
            <Space size={6}>
              <SendOutlined />
              <Text strong>Telegram</Text>
              <Text type="secondary" style={{ fontWeight: 400 }}>
                (opcional)
              </Text>
            </Space>
          </Divider>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Para qué sirve"
            description={
              <>
                Sin esto, el bot le responde «no autorizado» aunque ya tenga cuenta aquí: en el
                chat solo conoce un número de Telegram, no el correo. Para saber cuál es, pídele
                que le escriba <Text code>/start</Text> al bot y que te pase el número que le
                responde, o que abra <Text code>@userinfobot</Text> en Telegram.
              </>
            }
          />

          <Form.Item
            name="telegram_user_id"
            label="Id de Telegram"
            rules={[
              {
                validator: (_, v) =>
                  !v || /^\d+$/.test(String(v).trim())
                    ? Promise.resolve()
                    : Promise.reject(new Error("Es solo números, sin @ ni espacios")),
              },
            ]}
            extra="Déjalo vacío si no usa el bot. Si lo borras, pierde el acceso al chat."
          >
            <Input placeholder="Ej.: 123456789" inputMode="numeric" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="telegram_username"
            label="Usuario de Telegram"
            extra="Solo para reconocerlo de un vistazo. No hace falta para que funcione."
          >
            <Input placeholder="sin la @" autoComplete="off" />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.rol !== cur.rol}>
            {({ getFieldValue }) => {
              const rol = (getFieldValue("rol") || "COBRADOR") as Rol;
              const rolTg = rol === "COBRADOR" ? "agente_cobros" : "supervisor";
              return (
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: -8 }}>
                  En el chat entrará como <Text code>{rolTg}</Text>, derivado de su rol{" "}
                  <Text code>{rol}</Text>. No se configuran por separado para que nadie tenga
                  más permisos en el chat que en la aplicación.
                </Text>
              );
            }}
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
