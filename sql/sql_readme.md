# 🗄️ SQL Server - Arquitectura de Datos y Motor Lógico

Esta carpeta contiene el corazón analítico y transaccional del proyecto. Toda la lógica pesada de conjuntos y el gobierno de reglas de negocio reside aquí, diseñado para SQL Server 2019 o superior.

## 🏗️ Patrones de Diseño Implementados

*   **Modelo Dimensional (Estrella):** Diseño optimizado para consultas analíticas con desnormalización estratégica en las dimensiones y *Clustered Columnstore Indexes* en las tablas de hechos.
*   **Table-Valued Functions (TVFs) en Línea:** Toda la lógica de negocio compleja (cálculo de fuga, detección de quiebres persistentes) está encapsulada en TVFs en línea parametrizadas. Esto permite:
    *   Reutilizar la lógica en Power BI (mediante vistas wrapper).
    *   Reutilizar la misma lógica desde la API para simular escenarios *antes* de aplicarlos.
    *   Garantizar rendimiento, ya que el optimizador de SQL Server puede expandirlas en la consulta externa.
*   **Esquemas Separados:** Separación estricta entre los datos analíticos (`dbo`) y los metadatos operativos/configuración de la API (`app`), facilitando la seguridad y los respaldos.
*   **Auditoría y Trazabilidad:** Uso de `SESSION_CONTEXT` y triggers en el esquema `app` para registrar el origen de cada cambio (quién y cuándo), incluso cuando las modificaciones provienen del pool de conexiones genérico de la API.

## 📂 Orden de Ejecución y Descripción de Archivos

La base de datos debe ser desplegada siguiendo exactamente este orden (reflejado también en el script de carga masiva):

1.  **`dw_supermercado_star_schema.sql`:**
    *   Crea el esquema dimensional en `dbo` (Dimensión Tiempo, Sucursal, Producto, Cliente).
    *   Crea las tablas de hechos (`FactVentas` y `FactStockDiario`).
    *   Implementa índices columnstore para compresión y velocidad en agregaciones.
    *   Maneja claves subrogadas (SCD Tipo 2) para el historial de productos.

2.  **`carga_bulk_insert.sql`:**
    *   Script automatizado para cargar los archivos CSV generados sintéticamente usando `BULK INSERT`.
    *   Utiliza `TABLOCK` y tamaños de lote estratégicos para maximizar la velocidad de carga.
    *   Re-habilita e inspecciona las *Foreign Keys* post-carga para asegurar que el optimizador confíe en ellas.

3.  **`00_permisos_api_admin.sql` & `reafirmacion_de_permisos.sql`:**
    *   Creación del login y usuario de SQL Server (`api_admin`) dedicado para la API.
    *   Asignación de roles de lectura/escritura (`db_datareader`, `db_datawriter`) y permisos de ejecución sobre el esquema `app`.

4.  **`01_app_schema.sql`:**
    *   Crea el esquema `app`.
    *   Define las tablas para la web app: `ParametrosNegocio` (límites de fuga, metas), `Alerta` (gestión de quiebres de stock), e historial de auditoría.
    *   Crea los triggers para el seguimiento de cambios usando `SESSION_CONTEXT`.

5.  **`02_motor_logico_tvfs.sql`:**
    *   El motor de inteligencia del negocio.
    *   `fn_ClientesFugados`: Lógica compleja que usa *Window Functions* (`LAG`) a nivel ticket para calcular la frecuencia histórica de cada cliente y compararla dinámicamente con su periodo de inactividad actual.
    *   `fn_QuiebresPersistentes`: Análisis *Gaps & Islands* (usando el patrón `ROW_NUMBER`) para identificar rachas de snapshots consecutivos con stock cero, cruzando SCD2.
    *   Genera las vistas wrapper (ej. `vw_ClientesFugados`) que consumirá Power BI leyendo la configuración activa.

6.  **`03_app_canales_pipeline.sql` a `05_app_usuarios.sql`:**
    *   Estructuras adicionales requeridas por la API Node.js y el pipeline de Python.
    *   Gestión de canales de notificación (Email, SMS, Slack), cifrado de credenciales a nivel base de datos y la tabla de usuarios con RBAC para el panel de administración web.

7.  **`06_vista_rachas_quiebre.sql` & `crear_campania_enviar_cupones.sql`:**
    *   Scripts de inicialización y simulación.
    *   Pueblan la base de datos operativa (`app.Alerta`, `app.Campania`) basándose en los datos analíticos para que Power BI y el Frontend tengan un estado "en progreso" realista y demostrable inmediatamente después del despliegue.

## 🚀 Notas sobre la Carga de Datos

Si bien el DDL inicial crea un "Miembro Desconocido" (ClienteKey = 0) para las compras sin registrar, la generación sintética de los CSV en Python ya contempla esta fila. Asegúrese de limpiar las tablas de dimensiones *antes* de realizar el `BULK INSERT` para evitar conflictos de identidad.