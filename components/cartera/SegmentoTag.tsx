"use client";

import { Tag } from "antd";
import type { SegmentoRiesgo } from "@/lib/types/cartera";
import { colorSegmento } from "@/lib/utils/formato";

const labels: Record<SegmentoRiesgo, string> = {
  VERDE: "Verde",
  AMARILLO: "Amarillo",
  NARANJA: "Naranja",
  ROJO: "Rojo",
};

export default function SegmentoTag({ segmento }: { segmento: SegmentoRiesgo }) {
  return (
    <Tag color={colorSegmento(segmento)} style={{ fontWeight: 600 }}>
      {labels[segmento]}
    </Tag>
  );
}
