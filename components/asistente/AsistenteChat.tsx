"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Badge,
  Button,
  Input,
  Tag,
  Tooltip,
  Spin,
  message as antMessage,
} from "antd";
import {
  RobotOutlined,
  SendOutlined,
  CloseOutlined,
  CheckCircleOutlined,
  StopOutlined,
  DashboardOutlined,
  UnorderedListOutlined,
  MinusOutlined,
} from "@ant-design/icons";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface GestionCard {
  id: number;
  codigo_cliente: string;
  canal: "EMAIL" | "WHATSAPP" | "AMBOS";
  segmento_riesgo: "VERDE" | "AMARILLO" | "NARANJA" | "ROJO";
  saldo_pendiente: number;
  dias_vencido: number;
  mensaje_propuesto_email: string | null;
  mensaje_propuesto_wa: string | null;
  asunto_email: string | null;
}

type ChatMsg =
  | { type: "user"; text: string; id: string }
  | { type: "bot"; html: string; id: string; gestion_id?: number; accion?: "aprobado" | "descartado" }
  | { type: "gestion"; gestion: GestionCard; id: string; accion?: "aprobado" | "descartado" }
  | { type: "sistema"; text: string; id: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMonto(n: number) {
  return `RD$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SEGMENTO_COLOR: Record<string, string> = {
  VERDE: "green",
  AMARILLO: "gold",
  NARANJA: "orange",
  ROJO: "red",
};

const uid = () => Math.random().toString(36).slice(2);

// ─── Sub-componente: card de gestión pendiente ────────────────────────────────

function GestionPendienteCard({
  gestion,
  accion,
  onAprobar,
  onDescartar,
}: {
  gestion: GestionCard;
  accion?: "aprobado" | "descartado";
  onAprobar: (id: number) => void;
  onDescartar: (id: number) => void;
}) {
  const [loading, setLoading] = useState<"aprobando" | "descartando" | null>(null);
  const preview =
    gestion.canal === "WHATSAPP"
      ? gestion.mensaje_propuesto_wa
      : gestion.mensaje_propuesto_email;

  const handleAprobar = async () => {
    setLoading("aprobando");
    try {
      const r1 = await fetch(`/api/cobranzas/gestiones/${gestion.id}/aprobar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r1.ok) throw new Error((await r1.json()).error);

      const r2 = await fetch(`/api/cobranzas/gestiones/${gestion.id}/enviar`, {
        method: "POST",
      });
      if (!r2.ok) throw new Error((await r2.json()).error);

      onAprobar(gestion.id);
      antMessage.success("Enviado correctamente");
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setLoading(null);
    }
  };

  const handleDescartar = async () => {
    setLoading("descartando");
    try {
      const r = await fetch(`/api/cobranzas/gestiones/${gestion.id}/descartar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: "Descartado desde chat web" }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      onDescartar(gestion.id);
      antMessage.info("Gestión descartada");
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : "Error al descartar");
    } finally {
      setLoading(null);
    }
  };

  if (accion === "aprobado") {
    return (
      <div style={styles.card}>
        <div style={{ color: "#52c41a", fontWeight: 600 }}>
          <CheckCircleOutlined /> Enviado — {gestion.codigo_cliente}
        </div>
      </div>
    );
  }
  if (accion === "descartado") {
    return (
      <div style={{ ...styles.card, opacity: 0.5 }}>
        <div style={{ color: "#aaa" }}>
          <StopOutlined /> Descartado — {gestion.codigo_cliente}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{gestion.codigo_cliente}</span>
        <div style={{ display: "flex", gap: 4 }}>
          <Tag color={SEGMENTO_COLOR[gestion.segmento_riesgo]} style={{ margin: 0, fontSize: 10 }}>
            {gestion.segmento_riesgo}
          </Tag>
          <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
            {gestion.canal}
          </Tag>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
        {formatMonto(gestion.saldo_pendiente)} · {gestion.dias_vencido}d vencida
      </div>

      {gestion.asunto_email && (
        <div style={{ fontSize: 11, color: "#888", marginBottom: 4, fontStyle: "italic" }}>
          {gestion.asunto_email}
        </div>
      )}

      {preview && (
        <div style={styles.previewTexto}>
          {preview.slice(0, 180)}{preview.length > 180 ? "…" : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button
          type="primary"
          size="small"
          icon={<CheckCircleOutlined />}
          loading={loading === "aprobando"}
          disabled={!!loading}
          onClick={handleAprobar}
          style={{ flex: 1, fontSize: 12 }}
        >
          Aprobar y enviar
        </Button>
        <Button
          size="small"
          danger
          icon={<StopOutlined />}
          loading={loading === "descartando"}
          disabled={!!loading}
          onClick={handleDescartar}
          style={{ flex: 1, fontSize: 12 }}
        >
          Descartar
        </Button>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AsistenteChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingPending, setLoadingPending] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll al último mensaje
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Refrescar badge count en background cada 60s
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/cobranzas/cola-aprobacion");
        const data = await res.json();
        setPendingCount(Number(data.pendientes) || 0);
      } catch { /* ignore */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, []);

  const cargarPendientes = useCallback(async () => {
    setLoadingPending(true);
    try {
      const res = await fetch("/api/cobranzas/cola-aprobacion?limite=10");
      const data = await res.json();
      const gestiones: GestionCard[] = data.gestiones || [];
      setPendingCount(gestiones.length);

      if (gestiones.length === 0) {
        setMessages((prev) => [
          ...prev,
          {
            type: "bot",
            id: uid(),
            html: "✅ No hay gestiones pendientes de aprobación en este momento.",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            type: "bot",
            id: uid(),
            html: `📋 Hay <b>${gestiones.length}</b> gestión${gestiones.length > 1 ? "es" : ""} esperando tu aprobación:`,
          },
          ...gestiones.map((g): ChatMsg => ({
            type: "gestion",
            id: `gestion-${g.id}`,
            gestion: g,
          })),
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { type: "sistema", id: uid(), text: "Error cargando gestiones pendientes." },
      ]);
    } finally {
      setLoadingPending(false);
    }
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
    if (!initialized) {
      setInitialized(true);
      setMessages([
        {
          type: "bot",
          id: uid(),
          html: "👋 ¡Hola! Soy <b>Simpre</b>, tu asistente de cobranzas.<br/>Cargando gestiones pendientes…",
        },
      ]);
      cargarPendientes();
    }
  }, [initialized, cargarPendientes]);

  const handleAccionGestion = useCallback(
    (gestionId: number, accion: "aprobado" | "descartado") => {
      setMessages((prev) =>
        prev.map((m) =>
          m.type === "gestion" && m.gestion.id === gestionId
            ? { ...m, accion }
            : m
        )
      );
      setPendingCount((c) => Math.max(0, c - 1));
    },
    []
  );

  const enviarMensaje = useCallback(async () => {
    const texto = input.trim();
    if (!texto || sending) return;
    setInput("");
    setSending(true);

    setMessages((prev) => [...prev, { type: "user", id: uid(), text: texto }]);

    try {
      const res = await fetch("/api/cobranzas/asistente/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: texto }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Error del servidor");

      const botMsg: ChatMsg = {
        type: "bot",
        id: uid(),
        html: data.respuesta || "Sin respuesta.",
        gestion_id: data.gestion_id ?? undefined,
      };
      setMessages((prev) => [...prev, botMsg]);

      // Si el bot propuso una nueva gestión, añadirla como card
      if (data.gestion_id) {
        const cardRes = await fetch(
          `/api/cobranzas/cola-aprobacion?estado=PENDIENTE`
        );
        const cardData = await cardRes.json();
        const nueva = (cardData.gestiones as GestionCard[]).find(
          (g) => g.id === data.gestion_id
        );
        if (nueva) {
          setMessages((prev) => [
            ...prev,
            { type: "gestion", id: `gestion-${nueva.id}`, gestion: nueva },
          ]);
          setPendingCount((c) => c + 1);
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          type: "sistema",
          id: uid(),
          text: e instanceof Error ? e.message : "Error enviando mensaje.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  const accionRapida = useCallback(
    (texto: string) => {
      setInput(texto);
    },
    []
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Botón flotante */}
      {!open && (
        <Tooltip title="Abrir asistente de cobros" placement="left">
          <Badge count={pendingCount} offset={[-4, 4]} size="small">
            <Button
              type="primary"
              shape="round"
              size="large"
              icon={<RobotOutlined />}
              onClick={handleOpen}
              style={styles.floatBtn}
            >
              Simpre
            </Button>
          </Badge>
        </Tooltip>
      )}

      {/* Panel del chat */}
      {open && (
        <div style={styles.panel}>
          {/* Header */}
          <div style={styles.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <RobotOutlined style={{ fontSize: 18 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Simpre</span>
              {pendingCount > 0 && (
                <Badge
                  count={pendingCount}
                  style={{ backgroundColor: "#faad14" }}
                />
              )}
            </div>
            <Button
              type="text"
              size="small"
              icon={<MinusOutlined />}
              onClick={() => setOpen(false)}
              style={{ color: "#fff" }}
            />
          </div>

          {/* Mensajes */}
          <div style={styles.mensajes} ref={scrollRef}>
            {loadingPending && (
              <div style={{ textAlign: "center", padding: 16 }}>
                <Spin size="small" />
              </div>
            )}

            {messages.map((msg) => {
              if (msg.type === "user") {
                return (
                  <div key={msg.id} style={styles.bubbleUser}>
                    {msg.text}
                  </div>
                );
              }

              if (msg.type === "bot") {
                return (
                  <div key={msg.id} style={styles.bubbleBot}>
                    <span
                      dangerouslySetInnerHTML={{ __html: msg.html }}
                      style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}
                    />
                  </div>
                );
              }

              if (msg.type === "gestion") {
                return (
                  <GestionPendienteCard
                    key={msg.id}
                    gestion={msg.gestion}
                    accion={msg.accion}
                    onAprobar={(id) => handleAccionGestion(id, "aprobado")}
                    onDescartar={(id) => handleAccionGestion(id, "descartado")}
                  />
                );
              }

              // sistema
              return (
                <div key={msg.id} style={styles.bubbleSistema}>
                  ⚠️ {msg.text}
                </div>
              );
            })}

            {sending && (
              <div style={styles.bubbleBot}>
                <Spin size="small" />
                <span style={{ marginLeft: 8, color: "#999", fontSize: 12 }}>
                  Simpre está pensando…
                </span>
              </div>
            )}
          </div>

          {/* Acciones rápidas */}
          <div style={styles.quickActions}>
            <Button
              size="small"
              icon={<DashboardOutlined />}
              onClick={() => accionRapida("Estado del día")}
              style={{ fontSize: 11 }}
            >
              Estado
            </Button>
            <Button
              size="small"
              icon={<UnorderedListOutlined />}
              onClick={() => {
                setMessages((prev) => [
                  ...prev,
                  { type: "bot", id: uid(), html: "Recargando gestiones pendientes…" },
                ]);
                cargarPendientes();
              }}
              style={{ fontSize: 11 }}
            >
              Pendientes
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => {
                setMessages([]);
                setInitialized(false);
              }}
              style={{ fontSize: 11 }}
              danger
            >
              Limpiar
            </Button>
          </div>

          {/* Input */}
          <div style={styles.inputArea}>
            <Input
              placeholder="Pregúntame algo…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={enviarMensaje}
              disabled={sending}
              suffix={
                <Button
                  type="primary"
                  shape="circle"
                  size="small"
                  icon={<SendOutlined />}
                  onClick={enviarMensaje}
                  disabled={!input.trim() || sending}
                />
              }
            />
          </div>
        </div>
      )}
    </>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = {
  floatBtn: {
    position: "fixed" as const,
    bottom: 24,
    right: 24,
    zIndex: 1000,
    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
  },
  panel: {
    position: "fixed" as const,
    bottom: 24,
    right: 24,
    width: 380,
    height: 560,
    zIndex: 1000,
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    border: "1px solid #e8e8e8",
  },
  header: {
    background: "linear-gradient(135deg, #1890ff 0%, #096dd9 100%)",
    color: "#fff",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
  },
  mensajes: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "12px 12px 4px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  bubbleBot: {
    background: "#f0f7ff",
    border: "1px solid #bae0ff",
    borderRadius: "4px 12px 12px 12px",
    padding: "8px 12px",
    fontSize: 13,
    color: "#111",
    alignSelf: "flex-start" as const,
    maxWidth: "95%",
  },
  bubbleUser: {
    background: "#1890ff",
    color: "#fff",
    borderRadius: "12px 12px 4px 12px",
    padding: "8px 12px",
    fontSize: 13,
    alignSelf: "flex-end" as const,
    maxWidth: "80%",
    wordBreak: "break-word" as const,
  },
  bubbleSistema: {
    background: "#fff7e6",
    border: "1px solid #ffd591",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12,
    color: "#874d00",
    alignSelf: "center" as const,
  },
  card: {
    background: "#fafafa",
    border: "1px solid #d9d9d9",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 12,
    alignSelf: "flex-start" as const,
    width: "100%",
  },
  previewTexto: {
    background: "#f5f5f5",
    borderRadius: 4,
    padding: "6px 8px",
    fontSize: 11,
    color: "#555",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    maxHeight: 80,
    overflowY: "auto" as const,
  },
  quickActions: {
    display: "flex",
    gap: 6,
    padding: "6px 12px",
    borderTop: "1px solid #f0f0f0",
    flexShrink: 0,
  },
  inputArea: {
    padding: "8px 12px 12px",
    flexShrink: 0,
    borderTop: "1px solid #f0f0f0",
  },
} as const;
