# ⚙️ Backend API - Retail Analytics

Esta es la API RESTful construida con **Node.js y Express** que sirve como puente de comunicación entre el Panel de Administración (Frontend en React) y el Data Warehouse en SQL Server.

Su rol principal es gestionar el esquema `app` de la base de datos de manera segura, aislando la lógica operativa de los datos puramente analíticos.

## 🛠️ Tecnologías Principales

* **Node.js + Express**: Servidor web rápido, asíncrono y minimalista.

* **mssql (Tedious)**: Driver oficial para conectar con SQL Server mediante Connection Pooling.

* **Zod**: Validación estricta de esquemas (Schema Validation) en cada Request para evitar inyección de datos sucios.

* **JWT (JSON Web Tokens)**: Autenticación stateless y segura.

* **Pino**: Logger de alto rendimiento para auditoría detallada de los accesos al servidor.

## 🌟 Características Clave

1. **Role-Based Access Control (RBAC)**: Los endpoints están protegidos por roles lógicos (`ADMIN`, `SUPPLY`, `LECTURA`), asegurando que solo los perfiles correctos realicen mutaciones.

2. **Auditoría con `SESSION_CONTEXT`**: Al autenticar a un usuario, la API pasa su identidad directamente a la sesión de SQL Server. Esto permite que los `TRIGGERS` nativos de SQL Server registren automáticamente qué humano hizo el cambio (en tablas de historial) sin tener que ensuciar las consultas en Node.js.

3. **Manejo de Errores Centralizado**: Un middleware captura excepciones, rechaza payloads inválidos (vía Zod) y unifica los códigos HTTP (400, 401, 403, 500) para un consumo limpio desde el Frontend.

4. **Simulación de Reglas**: Endpoints diseñados específicamente para "jugar" con la base de datos simulando impactos de negocio (Ej: Tasa de fuga) sin escribir datos permanentes.

## 📂 Estructura del Código

La arquitectura sigue una estricta separación de capas (Rutas -> Servicios -> Base de Datos) para mantener el código modular y testeable.

```text
backend/
├── scripts/
│   ├── crear-usuario.js       # CLI para sembrar el primer usuario administrador
│   ├── generar-token.js       # Genera tokens JWT manuales para pruebas aisladas de API
│   └── smoke.js               # Smoke test automatizado para validar conexión DB y configuración
├── src/
│   ├── middleware/
│   │   ├── auth.js            # Validación de JWT y control de acceso por roles (RBAC)
│   │   └── errores.js         # Interceptor centralizado de errores (normaliza respuestas HTTP)
│   ├── rutas/                 # Definición de endpoints HTTP y asociación con los servicios
│   │   ├── alertas.js         # Endpoints para gestionar las alertas de quiebre de stock
│   │   ├── auth.js            # Endpoints de autenticación y login
│   │   ├── campanias.js       # Endpoints para el ABM de campañas de retención
│   │   ├── canales.js         # Endpoints de configuración de canales (Email, SMS)
│   │   ├── enrutamiento.js    # Agregador principal que monta todas las sub-rutas en /api
│   │   ├── parametros.js      # Endpoints para ajustar reglas de negocio (ej. límites de churn)
│   │   └── pipeline.js        # Endpoints para interactuar/disparar el orquestador Python
│   ├── servicios/             # Lógica de negocio (Consultas SQL directas y procesamiento)
│   │   ├── alertas.js         # Reglas para cambio de estado de alertas (NUEVA -> RESUELTA)
│   │   ├── cifrado.js         # Encriptación AES de credenciales sensibles (ej: pass SMTP)
│   │   ├── correo.js          # Integración con NodeMailer para despachar campañas/alertas
│   │   ├── runner.js          # Ejecución como subproceso (child_process) del Pipeline ETL
│   │   └── simulador.js       # Ejecución de TVFs SQL para previsualizar impactos en vivo
│   ├── validacion/
│   │   └── esquemas.js        # Esquemas Zod que validan los payloads (body/query) recibidos
│   ├── app.js                 # Configuración del servidor Express, CORS y middlewares globales
│   ├── config.js              # Centralización y lectura validada de variables de entorno
│   ├── db.js                  # Manejo del Pool de conexiones a SQL Server
│   ├── logger.js              # Configuración de logs estructurados con la librería Pino
│   └── server.js              # Entrypoint: Inicializa dependencias y levanta el puerto web
├── .env.example               # Plantilla segura de variables de entorno requeridas
└── package.json               # Dependencias npm y comandos de ejecución
```

## 🚀 Instalación y Ejecución

1. **Instalar dependencias:**

   ```bash
   npm install
   ```

2. **Configuración (.env):**
   Duplica el archivo `.env.example`, nómbralo `.env` y configura tus credenciales de SQL Server:

   ```env
   # IMPORTANTE: Si usas SQL Server Express, define la instancia así:
   DW_SERVER=localhost
   DW_DATABASE=DW_Supermercado
   DW_USER=api_admin
   DW_PASSWORD=tu_password
   JWT_SECRET=un_secreto_muy_seguro_de_32_caracteres
   ```

3. **Crear usuario semilla:**
   Antes de iniciar, necesitas un usuario para acceder al panel. Se crea vía línea de comandos para evitar endpoints abiertos de registro público.

   ```bash
   # Crear el primer usuario administrador para poder acceder al panel web
   # Nota: La contraseña requiere un mínimo de 8 caracteres, incluyendo mayúsculas y números.
   npm run usuario -- --usuario admin --nombre "Administrador" --password Admin1234 --roles ADMIN
   ```

   **Gestión de Roles (RBAC):**
   Puedes asignar uno o múltiples roles separándolos por comas (ej. `--roles SUPPLY,LECTURA`). Los permisos disponibles son:
   *   `ADMIN`: Acceso total (modificación de reglas de negocio, canales de alerta, campañas).
   *   `SUPPLY`: Gestión operativa (solo puede cambiar estados en alertas de quiebre de stock).
   *   `LECTURA`: Permite ver el panel y las configuraciones, pero bloquea cualquier mutación/guardado.

4. **Iniciar servidor:**

   ```bash
   npm start
   # o en modo desarrollo con auto-reload:
   # npm run dev
   ```

   La API estará escuchando peticiones en `http://localhost:3001/api`.