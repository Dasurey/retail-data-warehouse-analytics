/* =====================================================================
   04 - CANALES: AGREGAR TIPO 'sms'
   ---------------------------------------------------------------------
   Migracion incremental e idempotente. El panel gestiona un telefono
   de guardia como canal, asi que el CHECK de tipos se reconstruye
   incluyendo 'sms'. Segura de re-ejecutar y segura si 03 aun no corrio
   (en ese caso no hace nada y 03 ya deberia incluirse antes).
   ===================================================================== */

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_CanalAlerta_Tipo'
      AND definition NOT LIKE '%sms%'
)
BEGIN
    ALTER TABLE app.CanalAlerta DROP CONSTRAINT CK_CanalAlerta_Tipo;
END
GO

IF OBJECT_ID(N'app.CanalAlerta') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CanalAlerta_Tipo')
BEGIN
    ALTER TABLE app.CanalAlerta WITH CHECK
        ADD CONSTRAINT CK_CanalAlerta_Tipo
        CHECK (Tipo IN ('slack', 'teams', 'email', 'sms'));
END
GO
