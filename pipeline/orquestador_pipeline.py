# -*- coding: utf-8 -*-
"""
=====================================================================
ORQUESTADOR DEL PIPELINE v2 - DW CADENA DE SUPERMERCADOS
=====================================================================
La migracion final del roadmap: el orquestador deja de simular y se
integra con el esquema app.

  1. CONFIG GOBERNADA : lee app.ConfigParametro (no mas env vars de
     negocio). Cambios desde el panel = proxima corrida distinta.
  2. COLA DE CORRIDAS : toma solicitudes de app.PipelineRun (las que
     encola el boton "Ejecutar ahora"), las pasa a EN_CURSO y las
     cierra en OK/ERROR con metricas. Si lo dispara el cron y no hay
     solicitud, registra su propia corrida igual.
  3. ALERTAS REALES   : ejecuta dbo.fn_QuiebresPersistentes con los
     parametros vigentes y hace upsert idempotente via
     app.usp_UpsertAlerta -> la bandeja y la dona del panel se pueblan.
  4. NOTIFICACION     : resuelve el canal con app.ReglaEnrutamiento
     (primera regla activa que matchea), descifra el destino
     (AES-256-GCM, mismo formato que la API de Node) y hace el POST
     real a Slack/Teams. Best-effort: si falla el envio, la alerta ya
     quedo registrada igual.
  5. RECOMPRAS        : cruza app.AccionRetencion con FactVentas y
     marca RECOMPRADO. El dato de la Tasa de Recuperacion nace solo.

Uso:
    python orquestador_pipeline.py --env ../backend/.env   # una corrida
    python orquestador_pipeline.py --env ../backend/.env --watch
    python orquestador_pipeline.py --demo                  # sin base

Entorno (mismas variables que la API): DW_SERVER, DW_PORT, DW_DATABASE,
DW_USER, DW_PASSWORD, [DW_DRIVER], [CIFRADO_CLAVE para notificar].
Dependencias: pip install sqlalchemy pyodbc cryptography requests
=====================================================================
"""

import argparse
import base64
import logging
import os
import sys
import time
from datetime import datetime

log = logging.getLogger("pipeline_dw")

# ---------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------
MESES_ES = ["", "ene", "feb", "mar", "abr", "may", "jun",
            "jul", "ago", "sep", "oct", "nov", "dic"]


def _plata(x) -> str:
    return "$ " + f"{float(x):,.0f}".replace(",", ".")


def _mes(f) -> str:
    return f"{MESES_ES[f.month]}-{f.year}"


def cargar_env(ruta: str) -> None:
    """Parser minimo de .env (sin dependencia): KEY=VALOR por linea."""
    try:
        with open(ruta, encoding="utf-8") as archivo:
            for linea in archivo:
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                clave, _, valor = linea.partition("=")
                os.environ.setdefault(clave.strip(), valor.strip())
        log.info("Entorno cargado desde %s", ruta)
    except FileNotFoundError:
        log.warning("No existe %s: se usa el entorno actual", ruta)


def descifrar_destino(paquete: str) -> str:
    """Descifra el formato de la API de Node: base64(iv).base64(tag).base64(ct)
    con AES-256-GCM. La clave es la misma CIFRADO_CLAVE (64 chars hex)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    clave_hex = os.environ.get("CIFRADO_CLAVE", "")
    if len(clave_hex) != 64:
        raise RuntimeError("CIFRADO_CLAVE ausente o invalida (64 chars hex)")
    iv, tag, cifrado = (base64.b64decode(p) for p in paquete.split("."))
    return AESGCM(bytes.fromhex(clave_hex)).decrypt(iv, cifrado + tag, None).decode("utf-8")


# ---------------------------------------------------------------
# Acceso a datos
# ---------------------------------------------------------------
def crear_engine():
    from sqlalchemy import create_engine
    from sqlalchemy.engine import URL

    url = URL.create(
        "mssql+pyodbc",
        username=os.environ["DW_USER"],
        password=os.environ["DW_PASSWORD"],
        host=os.environ.get("DW_SERVER", "localhost"),
        port=int(os.environ.get("DW_PORT", "1433")),
        database=os.environ.get("DW_DATABASE", "DW_Supermercado"),
        query={
            "driver": os.environ.get("DW_DRIVER", "ODBC Driver 18 for SQL Server"),
            "TrustServerCertificate": "yes",
        },
    )
    return create_engine(url, pool_pre_ping=True)


DEFAULTS = {
    "MIN_SNAPSHOTS_QUIEBRE": 2,
    "UMBRAL_VENTA_PERDIDA": 40000,
}


def leer_config(engine) -> dict:
    """Fuente de verdad: app.ConfigParametro (la que edita el panel)."""
    from sqlalchemy import text

    with engine.connect() as cx:
        filas = cx.execute(text(
            "SELECT Clave, ValorNumerico FROM app.ConfigParametro WHERE Tipo = 'NUMERICO'"
        )).all()
    cfg = {**DEFAULTS, **{f.Clave: float(f.ValorNumerico) for f in filas}}
    log.info("Config gobernada: min_snapshots=%s, umbral_venta_perdida=%s",
             int(cfg["MIN_SNAPSHOTS_QUIEBRE"]), _plata(cfg["UMBRAL_VENTA_PERDIDA"]))
    return cfg


# ---------------------------------------------------------------
# Ciclo de vida de la corrida (app.PipelineRun)
# ---------------------------------------------------------------
def tomar_o_crear_run(engine, solo_solicitadas: bool):
    """Toma la solicitud pendiente mas antigua (UPDLOCK + READPAST: dos
    workers jamas toman la misma). Si no hay y la invocacion es directa
    (cron/manual), registra su propia corrida."""
    from sqlalchemy import text

    with engine.begin() as cx:
        fila = cx.execute(text("""
            UPDATE TOP (1) pr
               SET Estado = 'EN_CURSO', FechaInicio = SYSDATETIME()
            OUTPUT inserted.RunId
            FROM app.PipelineRun AS pr WITH (UPDLOCK, READPAST)
            WHERE pr.Estado = 'SOLICITADA';""")).fetchone()
        if fila:
            log.info("Solicitud #%d tomada de la cola.", fila.RunId)
            return fila.RunId
        if solo_solicitadas:
            return None
        fila = cx.execute(text("""
            INSERT INTO app.PipelineRun (Estado, DisparadoPor, FechaInicio)
            OUTPUT inserted.RunId
            VALUES ('EN_CURSO', 'orquestador', SYSDATETIME());""")).fetchone()
        log.info("Corrida directa #%d registrada.", fila.RunId)
        return fila.RunId


def cerrar_run(engine, run_id, ok, alertas, detalle):
    from sqlalchemy import text

    with engine.begin() as cx:
        cx.execute(text("""
            UPDATE app.PipelineRun
               SET Estado = :estado, FechaFin = SYSDATETIME(),
                   AlertasEmitidas = :alertas, Detalle = :detalle
             WHERE RunId = :id;"""),
            {"estado": "OK" if ok else "ERROR", "alertas": alertas,
             "detalle": detalle[:1000], "id": run_id})


# ---------------------------------------------------------------
# Paso 1: quiebres -> alertas (upsert idempotente)
# ---------------------------------------------------------------
def procesar_quiebres(engine, cfg):
    from sqlalchemy import text

    with engine.connect() as cx:
        rachas = cx.execute(text("""
            SELECT q.ProductoCodigo, q.SucursalKey, q.SucursalNombre,
                   q.ProductoNombre, q.MesInicio, q.MesFin,
                   q.SnapshotsEnQuiebre, q.VentaPerdidaEstimada,
                   s.Region, p.Categoria
            FROM dbo.fn_QuiebresPersistentes(:minimo) q
            JOIN dbo.DimSucursal s ON s.SucursalKey = q.SucursalKey
            JOIN dbo.DimProducto p ON p.ProductoCodigo = q.ProductoCodigo
                                  AND p.EsVigente = 1
            WHERE q.VentaPerdidaEstimada >= :umbral
            ORDER BY q.VentaPerdidaEstimada DESC;"""),
            {"minimo": int(cfg["MIN_SNAPSHOTS_QUIEBRE"]),
             "umbral": cfg["UMBRAL_VENTA_PERDIDA"]}).all()

    with engine.begin() as cx:
        for r in rachas:
            cx.execute(text("""
                EXEC app.usp_UpsertAlerta
                     @ProductoCodigo = :pc, @SucursalKey = :sk,
                     @MesInicio = :mi, @MesFin = :mf,
                     @SnapshotsEnQuiebre = :sn, @VentaPerdidaEstimada = :vp;"""),
                {"pc": r.ProductoCodigo, "sk": r.SucursalKey,
                 "mi": r.MesInicio, "mf": r.MesFin,
                 "sn": r.SnapshotsEnQuiebre, "vp": r.VentaPerdidaEstimada})
    log.info("%d alertas criticas upserteadas en app.Alerta.", len(rachas))
    return rachas


# ---------------------------------------------------------------
# Paso 2: notificacion enrutada (best-effort)
# ---------------------------------------------------------------
def resolver_canal(engine, region, categoria, venta_perdida):
    from sqlalchemy import text

    with engine.connect() as cx:
        return cx.execute(text("""
            SELECT TOP (1) c.CanalId, c.Nombre, c.Tipo, c.DestinoCifrado
            FROM app.ReglaEnrutamiento re
            JOIN app.CanalAlerta c ON c.CanalId = re.CanalId AND c.Activo = 1
            WHERE re.Activo = 1
              AND (re.CondRegion      IS NULL OR re.CondRegion      = :region)
              AND (re.CondCategoria   IS NULL OR re.CondCategoria   = :categoria)
              AND (re.VentaPerdidaMin IS NULL OR :vp >= re.VentaPerdidaMin)
            ORDER BY re.Prioridad;"""),
            {"region": region, "categoria": categoria, "vp": venta_perdida}).fetchone()


def notificar(engine, rachas):
    """Agrupa las alertas por canal resuelto y dispara el POST real a los
    webhooks. Sin reglas, sin canal o sin CIFRADO_CLAVE => se loguea y
    sigue: la notificacion es best-effort, el registro en app.Alerta no."""
    import requests

    grupos = {}
    for r in rachas:
        canal = resolver_canal(engine, r.Region, r.Categoria, r.VentaPerdidaEstimada)
        if canal is None:
            continue
        grupos.setdefault((canal.CanalId, canal.Nombre, canal.Tipo, canal.DestinoCifrado),
                          []).append(r)

    if not grupos:
        log.info("Sin canal de destino para las alertas (no hay reglas que matcheen).")
        return 0

    enviados = 0
    for (canal_id, nombre, tipo, destino_cifrado), alertas in grupos.items():
        lineas = [f":rotating_light: *{len(alertas)} alerta(s) de quiebre persistente*", ""]
        for a in alertas[:10]:
            lineas.append(
                f"• *{a.SucursalNombre}* — {a.ProductoNombre}: "
                f"{a.SnapshotsEnQuiebre} meses ({_mes(a.MesInicio)} → {_mes(a.MesFin)}) · "
                f"venta perdida *{_plata(a.VentaPerdidaEstimada)}*")
        lineas += ["", "Gestion: Panel de Administracion → Bandeja de alertas"]
        mensaje = "\n".join(lineas)

        if tipo not in ("slack", "teams"):
            log.info("Canal '%s' (%s): envio no-webhook simulado (%d alertas).",
                     nombre, tipo, len(alertas))
            continue
        try:
            destino = descifrar_destino(destino_cifrado)
            respuesta = requests.post(destino, json={"text": mensaje}, timeout=5)
            log.info("Canal '%s': webhook respondio HTTP %d (%d alertas).",
                     nombre, respuesta.status_code, len(alertas))
            enviados += 1
        except Exception as exc:
            log.warning("Canal '%s': no se pudo notificar (%s). Las alertas quedaron "
                        "registradas igual.", nombre, exc)
    return enviados


# ---------------------------------------------------------------
# Paso 3: deteccion de recompras
# ---------------------------------------------------------------
def marcar_recompras(engine) -> int:
    from sqlalchemy import text

    with engine.begin() as cx:
        resultado = cx.execute(text("""
            UPDATE a
               SET a.Estado = 'RECOMPRADO'
            FROM app.AccionRetencion a
            WHERE a.Estado IN ('EMITIDO', 'CANJEADO')
              AND EXISTS (
                  SELECT 1
                  FROM dbo.FactVentas f
                  JOIN dbo.DimTiempo t ON t.TiempoKey = f.TiempoKey
                  WHERE f.ClienteKey = a.ClienteKey
                    AND t.Fecha > a.FechaEnvio
              );"""))
        cuantos = resultado.rowcount or 0
    if cuantos:
        log.info("%d cliente(s) contactado(s) recompraron: Estado -> RECOMPRADO.", cuantos)
    return cuantos


# ---------------------------------------------------------------
# Corrida completa
# ---------------------------------------------------------------
def correr_pipeline(engine, run_id):
    inicio = time.monotonic()
    try:
        cfg = leer_config(engine)
        rachas = procesar_quiebres(engine, cfg)
        notificados = notificar(engine, rachas)
        recompras = marcar_recompras(engine)
        detalle = (f"{len(rachas)} alertas upserteadas · "
                   f"{notificados} canal(es) notificado(s) · "
                   f"{recompras} recompra(s) detectada(s) · "
                   f"{time.monotonic() - inicio:.1f}s")
        cerrar_run(engine, run_id, True, len(rachas), detalle)
        log.info("Corrida #%d OK: %s", run_id, detalle)
    except Exception as exc:
        cerrar_run(engine, run_id, False, 0, f"{type(exc).__name__}: {exc}")
        log.error("Corrida #%d en ERROR: %s", run_id, exc)
        raise


def modo_demo():
    log.info("MODO DEMO (sin base): asi se ve una corrida real.")
    print("\n" + "=" * 70)
    print("[SIMULACION SLACK] canal: #supply-chain-alertas")
    print("=" * 70)
    print(":rotating_light: *2 alerta(s) de quiebre persistente*\n")
    print("• *Sucursal San Isidro 2* — Medallones de pollo Dona Rosa 1.5 L: "
          "2 meses (jul-2025 → ago-2025) · venta perdida *$ 71.628*")
    print("• *Sucursal San Isidro* — Vacio Don Facundo Seleccion: "
          "2 meses (feb-2025 → mar-2025) · venta perdida *$ 63.846*")
    print("\nGestion: Panel de Administracion → Bandeja de alertas")
    print("=" * 70)
    log.info("Con base real: esto ademas escribe app.Alerta, cierra la corrida "
             "en app.PipelineRun y marca recompras.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Orquestador del pipeline del DW (v2)")
    parser.add_argument("--env", help="ruta a un archivo .env (ej: ../backend/.env)")
    parser.add_argument("--demo", action="store_true", help="sin base, salida de muestra")
    parser.add_argument("--watch", action="store_true",
                        help="queda vigilando la cola de solicitudes del panel")
    parser.add_argument("--solo-cola", action="store_true", dest="solo_cola",
                        help="procesa las solicitudes pendientes y termina; si la "
                             "cola esta vacia (otro worker se adelanto), no hace nada. "
                             "Es el modo del runner embebido de la API")
    parser.add_argument("--intervalo", type=int, default=15,
                        help="segundos entre chequeos en modo --watch")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s | %(levelname)-7s | %(message)s",
                        datefmt="%H:%M:%S")
    if args.env:
        cargar_env(args.env)

    if args.demo:
        modo_demo()
        return 0

    engine = crear_engine()
    log.info("Pipeline v2 iniciado (%s).", "modo watch" if args.watch else "corrida unica")

    if args.solo_cola:
        # Modo runner embebido: drena la cola SIN crear corridas propias.
        # Si --watch o el cron tomaron la solicitud primero (UPDLOCK =
        # un solo duenio), termina sin ejecutar nada: cero doble corrida.
        procesadas = 0
        while True:
            run_id = tomar_o_crear_run(engine, solo_solicitadas=True)
            if run_id is None:
                break
            correr_pipeline(engine, run_id)
            procesadas += 1
        log.info("Modo solo-cola: %d corrida(s) procesada(s).", procesadas)
        return 0

    if not args.watch:
        run_id = tomar_o_crear_run(engine, solo_solicitadas=False)
        correr_pipeline(engine, run_id)
        return 0

    log.info("Vigilando app.PipelineRun cada %ds. El boton 'Ejecutar ahora' "
             "del panel encola; aca se procesa. Ctrl+C para salir.", args.intervalo)
    while True:
        try:
            run_id = tomar_o_crear_run(engine, solo_solicitadas=True)
            if run_id is not None:
                correr_pipeline(engine, run_id)
        except KeyboardInterrupt:
            log.info("Watch detenido. Chau.")
            return 0
        except Exception:
            pass  # ya logueado y cerrado en ERROR; el watch sigue vivo
        time.sleep(args.intervalo)


if __name__ == "__main__":
    sys.exit(main())
