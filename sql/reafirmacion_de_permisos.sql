USE DW_Supermercado;
GO

-- Le otorgamos permiso de ejecucion al usuario sobre todo el esquema app
GRANT EXECUTE ON SCHEMA::app TO api_admin;
GO

-- Reafirmamos sus permisos de lectura y escritura sobre las tablas de la base
ALTER ROLE db_datareader ADD MEMBER api_admin;
ALTER ROLE db_datawriter ADD MEMBER api_admin;
GO