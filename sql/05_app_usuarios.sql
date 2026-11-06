/* =====================================================================
   05 - ESQUEMA app: USUARIOS DEL PANEL
   ---------------------------------------------------------------------
   Autenticacion propia con usuario y contrasenia (hash bcrypt generado
   por la API; la base jamas ve la contrasenia en claro). Los usuarios
   se crean con: npm run usuario -- --usuario ana --password ... 
   Idempotente.
   ===================================================================== */

IF OBJECT_ID(N'app.Usuario') IS NULL
BEGIN
    CREATE TABLE app.Usuario (
        UsuarioId      INT IDENTITY(1,1) NOT NULL,
        NombreUsuario  NVARCHAR(50)  NOT NULL,
        NombreCompleto NVARCHAR(100) NOT NULL,
        HashPassword   VARCHAR(80)   NOT NULL,   -- bcrypt ($2a$..., 60 chars)
        Roles          NVARCHAR(100) NOT NULL,   -- CSV: 'ADMIN' | 'SUPPLY,FIDELIZACION' | ...
        Activo         BIT           NOT NULL CONSTRAINT DF_Usuario_Activo DEFAULT (1),
        FechaCreacion  DATETIME2(0)  NOT NULL CONSTRAINT DF_Usuario_Creado DEFAULT (SYSDATETIME()),
        UltimoAcceso   DATETIME2(0)  NULL,

        CONSTRAINT PK_Usuario PRIMARY KEY CLUSTERED (UsuarioId),
        CONSTRAINT UQ_Usuario_Nombre UNIQUE (NombreUsuario)
    );
END
GO
