# 🛒 Retail Data Warehouse & Inteligencia Comercial

**Data Warehouse dimensional + pipeline automatizado + panel de administración full-stack + capa analítica en Power BI**, construidos de punta a punta para una cadena de supermercados: del `CREATE TABLE` al botón de "Simular impacto".

## ⏱️ El proyecto en 2 minutos

|  |  | 
| ----- | ----- | 
| **Qué es** | Una plataforma que no solo *mide* el negocio (DW + Power BI) sino que *actúa* sobre él: alertas de quiebre de stock con workflow de gestión, campañas de retención de clientes, y reglas de negocio parametrizables desde una web app con **simulación de impacto antes de guardar**. | 
| **El diferencial** | El círculo completo: las decisiones tomadas en el panel quedan registradas, alimentan al pipeline y **vuelven al tablero** como métricas de efectividad (¿la campaña recupera clientes? ¿gestionar las alertas acorta los quiebres?). | 
| **Contexto argentino** | Con inflación constante, la facturación nominal miente: el proyecto separa crecimiento real de inflación en SQL, en DAX y en la simulación de la API. | 
| **Calidad** | Todo lo entregado está verificado con datos: +220.000 líneas de venta sintéticas con estacionalidad e integridad referencial, refactor a TVFs validado con **tests de regresión (resultados idénticos fila a fila)**, smoke tests de backend y frontend. | 

**Resultados validados sobre el dataset (3 años de operación simulada):**
Diciembre vende **1,89×** el mes promedio · la peor racha de quiebre cuesta **\$71.628** de venta perdida estimada · **23 clientes de alto valor** en fuga silenciosa, el primero con **\$996.359** de gasto histórico siendo el **#3 de todo el segmento Premium** · la sensibilidad de las reglas responde dinámicamente.

## 🏗️ Arquitectura

```
flowchart LR
    subgraph SQL["SQL Server"]
        DW[("Esquema dbo<br/>Estrella + TVFs parametrizables<br/>+ vistas wrapper")]
        APP[("Esquema app<br/>Parámetros · Alertas<br/>Campañas · Auditoría")]
    end
    ORQ["Orquestador Python<br/>(SQL Agent / cron)"] -- "1. lee parámetros" --> APP
    ORQ -- "2. ejecuta TVFs" --> DW
    ORQ -- "3. upsert alertas y acciones" --> APP
    ORQ -- "4. notifica" --> EXT["Slack / Email"]
    API["API Node.js (REST)"] -- "CRUD + auditoría" --> APP
    FRONT["React — Panel Admin"] --> API
    PBI["Power BI (Import)"] -- "modelo semántico" --> DW
    PBI -- "feedback loop" --> APP
```

| Capa | Tecnología | Por qué | 
| ----- | ----- | ----- | 
| **Data Warehouse** | SQL Server 2019+, modelo estrella, **clustered columnstore** | Compresión \~10× y agregaciones en batch mode; claves subrogadas + SCD Tipo 2 en productos. | 
| **Lógica analítica** | T-SQL: CTEs, window functions, *gaps & islands*, **inline TVFs parametrizadas** | La lógica pesada de conjuntos vive en SQL; las reglas se gobiernan sin redeploy. | 
| **Datos sintéticos** | Python (pandas, NumPy, Faker es_AR) | +220.000 líneas y snapshots con estacionalidad, inflación interanual inversa y SCD2, reproducibles. | 
| **Pipeline** | Python (SQLAlchemy, pyodbc) | Alertas Slack y campañas de retención; modo `--demo` sin infraestructura. | 
| **API Backend** | Node.js 20, Express, mssql, zod, JWT/RBAC, pino | Única escritora del esquema `app`; auditoría vía `SESSION_CONTEXT` + triggers. | 
| **Panel Frontend** | React 18, TanStack Query v5, React Hook Form + Zod | Mutaciones optimistas donde corresponde, pesimistas donde no. Interfaz de negocio limpia. | 
| **BI Analytics** | Power BI, DAX, Field Parameters | El tablero mide el negocio **y** la gestión operativa de los usuarios. | 

## 💡 Los 3 problemas de negocio resueltos

### 1 · Desempeño comercial: crecimiento real vs inflación

**Problema:** En contextos inflacionarios, cualquier ranking en pesos ordena categorías por cuánto remarcaron, no por cuánto crecieron.
**Solución:** Uso avanzado de parámetros de campo (Field Parameters) en Power BI para permitir alternar entre "Pesos nominales", "Moneda constante" y "Volumen (Unidades)". Se implementó una lógica de deflactación dinámica alimentada por la configuración de la base de datos.

### 2 · Supply chain: quiebres de stock persistentes y venta perdida

**Problema:** Priorizar la reposición requiere saber qué quiebres duelen más y cuánto cuestan financieramente.
**Solución:** Lógica *gaps & islands* (`MesNum - ROW_NUMBER()`) en T-SQL para detectar rachas de snapshots consecutivos en quiebre, sobreviviendo a cambios de versión SCD2. Las rachas se convierten en **alertas con máquina de estados** (`NUEVA → EN_REVISIÓN → RESUELTA`) gestionadas desde la web app.

### 3 · Fidelización: fuga silenciosa de clientes de alto valor (Churn)

**Problema:** Detectar a tiempo cuándo un cliente excelente (Premium/Frecuente) está dejando de comprar.
**Solución:** Funciones tabulares (`fn_ClientesFugados`) reconstruyen las visitas a nivel ticket, calculan la frecuencia individual con `LAG`, y marcan fuga cuando el silencio supera *N×* su propia frecuencia. La API expone un endpoint para **simular** cambios en el algoritmo antes de guardarlos. El cierre del círculo es la medición en Power BI de la **Tasa de Recuperación a 60 días**.

## 📂 Estructura del repositorio

```
.
├── sql/
│   ├── dw_supermercado_star_schema.sql   # Estrella: 2 facts + 4 dims + columnstore
│   ├── carga_bulk_insert.sql             # Carga masiva (KEEPIDENTITY, UTF-8)
│   ├── 00_permisos_api_admin.sql         # Creación del login y usuario
│   ├── 01_app_schema.sql                 # Esquema app: config, alertas, auditoría
│   ├── 02_motor_logico_tvfs.sql          # TVFs parametrizadas + vistas wrapper
│   ├── 03_app_canales_pipeline.sql       # Tablas para el orquestador
│   ├── 04_app_canal_sms.sql              # Configuración de SMS
│   ├── 05_app_usuarios.sql               # Tabla de usuarios
│   ├── 06_vista_rachas_quiebre.sql       # Vista clave para Power BI
│   ├── crear_campania_enviar_cupones.sql # Inyección de la campaña simulada
│   └── reafirmacion_de_permisos.sql      # Script de seguridad (reparación de roles y accesos)
├── datos/
│   ├── csv_dw/                           # Achivos ya generados y estructurados sin que tener que generarlos con generar_datos_dw.py
│   └── generar_datos_dw.py               # Generador sintético (estacionalidad, SCD2, inflación)
├── pipeline/
│   └── orquestador_pipeline.py           # Alertas Slack + retención (modo --demo)
├── backend/                              # API Express (capas: rutas → servicios → db)
│   └── src/
├── frontend/                             # React + TanStack Query + Tailwind CSS
│   └── src/
├── powerbi/
│   ├── dashboard_retail.pbip             # Proyecto Power BI (Formato TMDL)
│   └── medidas_powerbi.dax               # Respaldo de las medidas DAX clave
└── README.md
```

## 🚀 Quickstart (Despliegue Local)

**Prerrequisitos:** SQL Server 2019+ (con `sqlcmd`), Python 3.11+, Node.js 20+, Power BI Desktop.

### 1 · Base de Datos y Carga

```
# 1. Creación de la base de datos
sqlcmd -S localhost -Q "CREATE DATABASE DW_Supermercado"

# 2. Despliegue del esquema estrella
sqlcmd -S localhost -d DW_Supermercado -i sql/dw_supermercado_star_schema.sql
```

```bash
# Si no queres usar los datos de los csv que a estan podes crear otros con generar_datos_dw.py usa una diferentes librerias para generar los datos.
# pip install pandas faker
# python datos/generar_datos_dw.py

# 3. Carga masiva de datos (BULK INSERT), poner la ruta absoluta de donde esta localizado el repositorio (datos\csv_dw ó datos\csv_dw_lib).
sqlcmd -S localhost -d DW_Supermercado -i sql/carga_bulk_insert.sql -v RutaCSV="C:\ruta\absoluta\a\tu\repo\datos\csv_dw"

# 3.1 Creación de usuario y permisos
sqlcmd -S localhost -d DW_Supermercado -i sql/00_permisos_api_admin.sql

# 4. Creación de esquemas operativos y reglas de negocio
sqlcmd -S localhost -d DW_Supermercado -i sql/01_app_schema.sql
sqlcmd -S localhost -d DW_Supermercado -i sql/02_motor_logico_tvfs.sql
sqlcmd -S localhost -d DW_Supermercado -i sql/03_app_canales_pipeline.sql
sqlcmd -S localhost -d DW_Supermercado -i sql/04_app_canal_sms.sql
sqlcmd -S localhost -d DW_Supermercado -i sql/05_app_usuarios.sql

# 5. Vistas y simulación de la campaña (Necesarias para Power BI)
sqlcmd -S localhost -d DW_Supermercado -i sql/06_vista_rachas_quiebre.sql
sqlcmd -S localhost -d DW_Supermercado -i sql/crear_campania_enviar_cupones.sql
```

### 2 · Pipeline (opcional, no es necesario porque ya lo hizo `sql/crear_campania_enviar_cupones.sql`)

```bash
# sqlcmd -S localhost -d DW_Supermercado -i sql/reafirmacion_de_permisos.sql
# pip install sqlalchemy pyodbc
# python pipeline/orquestador_pipeline.py --demo                             # Sin base: muestra alertas y campaña
# python pipeline/orquestador_pipeline.py --env backend/.env                 # Contra SQL Server (variables DW_*)
```

### 3 · Backend API y Creación de Usuario

```bash
cd backend
npm install
# Configurar archivo .env con las credenciales de SQL Server basadas en .env.example
# IMPORTANTE: Si usas SQL Server Express local, configurar DW_SERVER=localhost

# 1. Crear el primer usuario administrador para poder acceder al panel web, 8 caracteres mínimo para la contraseña.
npm run usuario -- --usuario ana --nombre "Ana" --password TuClaveSegura1 --roles ADMIN 

# 2. Iniciar el servidor API
npm start                 # Inicia el servidor en http://localhost:3001
```

### 4 · Frontend Panel Admin

Abre una nueva terminal, manteniendo el backend en ejecución:

```bash
cd frontend
npm install
# Asegurarse de que VITE_API_URL=http://localhost:3001/api está en .env.local
npm run dev               # Inicia la web app operativa en http://localhost:5173
```

### 5 · Power BI

1. Abrir la carpeta `powerbi` y ejecutar el archivo `.pbip`.

2. Al abrir Power BI, si solicita actualizar debido a la falta de caché, hacer clic en **Actualizar ahora**.

3. (Opcional) Asegurarse de ir a *Archivo > Opciones* y desmarcar *Fecha y hora automáticas* en el archivo actual para mantener limpio el modelo TMDL.

## 👨‍💻 Autor

[Darío Asurey](https://github.com/Dasurey)