/* =====================================================================
   03 - ESQUEMA app: CANALES, ENRUTAMIENTO, CAMPANIAS Y PIPELINE
   ---------------------------------------------------------------------
   Migracion incremental (no toca 01_app_schema.sql). Idempotente.
   Completa el contrato de la API: /api/canales, /api/rutas,
   /api/campanias y /api/pipeline.
   ===================================================================== */

/* ---------------------------------------------------------------
   app.CanalAlerta - destinos de notificacion.
   El destino (webhook de Slack/Teams o email) se guarda CIFRADO
   (AES-256-GCM en la API); DestinoMascara existe para poder listar
   sin descifrar. Nota: la columna se llama Destino y no WebhookUrl
   porque un canal de email no tiene URL.
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.CanalAlerta') IS NULL
BEGIN
    CREATE TABLE app.CanalAlerta (
        CanalId            INT IDENTITY(1,1) NOT NULL,
        Nombre             NVARCHAR(60)  NOT NULL,
        Tipo               VARCHAR(10)   NOT NULL,   -- slack | teams | email
        DestinoCifrado     NVARCHAR(600) NOT NULL,
        DestinoMascara     NVARCHAR(60)  NOT NULL,
        Activo             BIT           NOT NULL CONSTRAINT DF_Canal_Activo DEFAULT (1),
        CreadoPor          NVARCHAR(100) NOT NULL,
        FechaCreacion      DATETIME2(0)  NOT NULL CONSTRAINT DF_Canal_Creado DEFAULT (SYSDATETIME()),
        FechaActualizacion DATETIME2(0)  NULL,

        CONSTRAINT PK_CanalAlerta PRIMARY KEY CLUSTERED (CanalId),
        CONSTRAINT UQ_CanalAlerta_Nombre UNIQUE (Nombre),
        CONSTRAINT CK_CanalAlerta_Tipo CHECK (Tipo IN ('slack', 'teams', 'email'))
    );
END
GO

/* ---------------------------------------------------------------
   app.ReglaEnrutamiento - "quiebres de Patagonia -> #supply-sur".
   Primera regla activa que matchea por Prioridad, gana. Condiciones
   NULL = comodin.
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.ReglaEnrutamiento') IS NULL
BEGIN
    CREATE TABLE app.ReglaEnrutamiento (
        ReglaId          INT IDENTITY(1,1) NOT NULL,
        Prioridad        INT           NOT NULL,
        CondRegion       NVARCHAR(40)  NULL,
        CondCategoria    NVARCHAR(50)  NULL,
        VentaPerdidaMin  DECIMAL(18,2) NULL,
        CanalId          INT           NOT NULL,
        Activo           BIT           NOT NULL CONSTRAINT DF_Regla_Activo DEFAULT (1),

        CONSTRAINT PK_ReglaEnrutamiento PRIMARY KEY CLUSTERED (ReglaId),
        CONSTRAINT UQ_ReglaEnrutamiento_Prioridad UNIQUE (Prioridad),
        CONSTRAINT FK_Regla_Canal FOREIGN KEY (CanalId)
            REFERENCES app.CanalAlerta (CanalId)
    );
END
GO

/* ---------------------------------------------------------------
   app.Campania + vinculo desde AccionRetencion.
   Una campania agrupa los cupones emitidos en un disparo.
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.Campania') IS NULL
BEGIN
    CREATE TABLE app.Campania (
        CampaniaId       INT IDENTITY(1,1) NOT NULL,
        FechaCreacion    DATETIME2(0)  NOT NULL CONSTRAINT DF_Campania_Fecha DEFAULT (SYSDATETIME()),
        CreadaPor        NVARCHAR(100) NOT NULL,
        TotalContactados INT           NOT NULL CONSTRAINT DF_Campania_Total DEFAULT (0),
        Nota             NVARCHAR(300) NULL,

        CONSTRAINT PK_Campania PRIMARY KEY CLUSTERED (CampaniaId)
    );
END
GO

IF COL_LENGTH(N'app.AccionRetencion', N'CampaniaId') IS NULL
BEGIN
    ALTER TABLE app.AccionRetencion ADD CampaniaId INT NULL;
END
GO

IF OBJECT_ID(N'app.FK_AccionRetencion_Campania', N'F') IS NULL
BEGIN
    ALTER TABLE app.AccionRetencion WITH CHECK
        ADD CONSTRAINT FK_AccionRetencion_Campania
        FOREIGN KEY (CampaniaId) REFERENCES app.Campania (CampaniaId);
END
GO

/* ---------------------------------------------------------------
   app.usp_EliminarCanal - baja segura de canales.
   No permite borrar un canal si tiene reglas de enrutamiento.
   La validacion queda en SQL para evitar carreras entre el check y
   el DELETE ejecutado por la API.
--------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE app.usp_EliminarCanal
    @CanalId INT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRAN;

        IF EXISTS (SELECT 1 FROM app.ReglaEnrutamiento WHERE CanalId = @CanalId)
        BEGIN
            THROW 50020, 'CANAL_EN_USO', 1;
        END

        DELETE FROM app.CanalAlerta
        WHERE CanalId = @CanalId;

        IF @@ROWCOUNT = 0
        BEGIN
            THROW 50021, 'CANAL_INEXISTENTE', 1;
        END

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END;
GO

/* ---------------------------------------------------------------
   app.PipelineRun - cola y bitacora de corridas.
   POST /api/pipeline/ejecutar inserta una fila SOLICITADA (202):
   la API nunca ejecuta procesos largos inline. El orquestador toma
   las solicitudes pendientes al arrancar y las va actualizando.
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.PipelineRun') IS NULL
BEGIN
    CREATE TABLE app.PipelineRun (
        RunId           INT IDENTITY(1,1) NOT NULL,
        Estado          VARCHAR(15)   NOT NULL CONSTRAINT DF_Run_Estado DEFAULT ('SOLICITADA'),
        DisparadoPor    NVARCHAR(100) NOT NULL,
        FechaSolicitud  DATETIME2(0)  NOT NULL CONSTRAINT DF_Run_Solicitud DEFAULT (SYSDATETIME()),
        FechaInicio     DATETIME2(0)  NULL,
        FechaFin        DATETIME2(0)  NULL,
        AlertasEmitidas INT           NULL,
        CuponesEmitidos INT           NULL,
        Detalle         NVARCHAR(1000) NULL,

        CONSTRAINT PK_PipelineRun PRIMARY KEY CLUSTERED (RunId),
        CONSTRAINT CK_PipelineRun_Estado
            CHECK (Estado IN ('SOLICITADA', 'EN_CURSO', 'OK', 'ERROR'))
    );

    CREATE NONCLUSTERED INDEX IX_PipelineRun_Estado
        ON app.PipelineRun (Estado, FechaSolicitud);
END
GO
