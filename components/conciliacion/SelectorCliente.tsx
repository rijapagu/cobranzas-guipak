"use client";

import { Select } from "antd";
import type { ClienteOption } from "@/lib/types/conciliacion";

interface Props {
  clientes: ClienteOption[];
  value?: string;
  onChange: (codigo: string, nombre: string) => void;
  placeholder?: string;
}

export default function SelectorCliente({ clientes, value, onChange, placeholder }: Props) {
  return (
    <Select
      showSearch
      placeholder={placeholder || "Buscar cliente..."}
      value={value || undefined}
      onChange={(val) => {
        const c = clientes.find((cl) => cl.codigo === val);
        onChange(val, c?.nombre || val);
      }}
      filterOption={(input, option) =>
        (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
      }
      options={clientes.map((c) => ({
        value: c.codigo,
        label: `${c.codigo} — ${c.nombre}`,
      }))}
      style={{ width: "100%" }}
    />
  );
}
