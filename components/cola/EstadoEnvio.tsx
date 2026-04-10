"use client";

import { Tag, Tooltip } from "antd";
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  SendOutlined,
  EyeOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  StopOutlined,
  ArrowUpOutlined,
} from "@ant-design/icons";
import type { EstadoGestion } from "@/lib/types/cobranzas";

const config: Record<EstadoGestion, { color: string; icon: React.ReactNode; label: string }> = {
  PENDIENTE: { color: "default", icon: <ClockCircleOutlined />, label: "Pendiente" },
  APROBADO: { color: "blue", icon: <CheckCircleOutlined />, label: "Aprobado" },
  EDITADO: { color: "cyan", icon: <CheckCircleOutlined />, label: "Editado" },
  DESCARTADO: { color: "default", icon: <StopOutlined />, label: "Descartado" },
  ESCALADO: { color: "orange", icon: <ArrowUpOutlined />, label: "Escalado" },
  ENVIADO: { color: "green", icon: <SendOutlined />, label: "Enviado" },
  FALLIDO: { color: "red", icon: <CloseCircleOutlined />, label: "Fallido" },
};

interface Props {
  estado: EstadoGestion;
  fechaEnvio?: string | null;
}

export default function EstadoEnvio({ estado, fechaEnvio }: Props) {
  const c = config[estado] || config.PENDIENTE;

  return (
    <Tooltip title={fechaEnvio ? `Enviado: ${fechaEnvio}` : c.label}>
      <Tag color={c.color} icon={c.icon}>
        {c.label}
      </Tag>
    </Tooltip>
  );
}
