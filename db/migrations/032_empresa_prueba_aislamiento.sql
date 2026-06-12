-- 032: Fase 3 Etapa 1 (cierre) — empresa 2 de prueba para el test de aislamiento.
-- Crea un tenant de prueba sin ERP y un usuario supervisor con empresa_id=2.
-- Sirve para verificar que un login de empresa 2 ve TODO vacio (cero datos Guipak).
-- La empresa queda activa=1 para poder hacer login; el usuario se puede
-- desactivar tras el test con: UPDATE usuarios SET activo=0 WHERE empresa_id=2;

INSERT IGNORE INTO empresas (id, nombre, slug, activa, plan, modo_datos, erp_tipo)
VALUES (2, 'Empresa Prueba Aislamiento', 'prueba-aislamiento', 1, 'ESTANDAR', 'COMPARTIDA', 'NINGUNO');

-- Password del usuario de prueba: ver nota interna de la sesion 2026-06-12
-- (hash bcrypt generado offline; cuenta solo para smoke tests de aislamiento).
INSERT IGNORE INTO usuarios (email, nombre, password_hash, rol, activo, empresa_id)
VALUES ('prueba@empresa2.test', 'Usuario Prueba Empresa 2',
        '$2b$10$DhwRXCa7JGSFHO3Ljjec2Oj9EtE0by7FanqNDjoUxaeteRJpckkyC',
        'SUPERVISOR', 1, 2);
