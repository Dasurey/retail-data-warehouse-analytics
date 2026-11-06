/* =====================================================================
   00 - PERMISOS PARA api_admin
   ---------------------------------------------------------------------
   Ejecutar una sola vez con un usuario con privilegios de administracion
   sobre la base DW_Supermercado.

   Da a api_admin permisos DDL suficientes para crear y mantener el
   esquema app, que es donde viven las tablas y procedimientos operativos.
   ===================================================================== */

IF SUSER_ID('api_admin') IS NULL
    CREATE LOGIN api_admin WITH PASSWORD = 'CAMBIAR';
GO

USE DW_Supermercado;
GO

IF USER_ID('api_admin') IS NULL
    CREATE USER api_admin FOR LOGIN api_admin;
GO

ALTER ROLE db_ddladmin ADD MEMBER api_admin;
ALTER ROLE db_datareader ADD MEMBER api_admin;
ALTER ROLE db_datawriter ADD MEMBER api_admin;
GO