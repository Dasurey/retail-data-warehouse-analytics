# -*- coding: utf-8 -*-
"""
=====================================================================
GENERADOR DE DATOS SINTETICOS - DW CADENA DE SUPERMERCADOS (2023-2025)
=====================================================================
Genera CSVs para las 6 tablas del modelo estrella, listos para
BULK INSERT en SQL Server (UTF-8, header en fila 1, NULL = campo vacio).

Novedades de esta versión final:
  - Genera datos de 2023 clonando y escalando los de 2024 para garantizar 
    curvas de crecimiento YoY (interanual) realistas en Power BI.
  - Inyecta compras de 'recuperación' post-campaña (Oct-Nov 2025) para 
    garantizar una tasa exacta de recuperación (aprox. 31%).
"""

from datetime import date, timedelta
from pathlib import Path
import numpy as np
import pandas as pd
from faker import Faker

# ---------------------------------------------------------------
# CONFIGURACION BASE
# ---------------------------------------------------------------
SEED              = 42
FECHA_INICIO      = date(2023, 1, 1)
FECHA_FIN         = date(2025, 12, 31)
N_PRODUCTOS_BASE  = 2000
N_PRODUCTOS_SCD2  = 100
N_CLIENTES        = 5000
N_SUCURSALES      = 40
N_TICKETS         = 38000
PCT_SIN_TARJETA   = 0.65
INFLACION_MENSUAL = 0.04
OUT_DIR           = Path("datos/csv_dw")

rng = np.random.default_rng(SEED)
Faker.seed(SEED)
fake = Faker("es_AR")
OUT_DIR.mkdir(exist_ok=True, parents=True)

MES_NOMBRE = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
              "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
DIA_NOMBRE = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]

FERIADOS = {
    date(2023, 1, 1), date(2023, 2, 20), date(2023, 2, 21), date(2023, 3, 24), date(2023, 4, 2), date(2023, 4, 6), date(2023, 4, 7), date(2023, 5, 1), date(2023, 5, 25), date(2023, 5, 26), date(2023, 6, 17), date(2023, 6, 19), date(2023, 6, 20), date(2023, 7, 9), date(2023, 8, 21), date(2023, 10, 13), date(2023, 10, 16), date(2023, 11, 20), date(2023, 12, 8), date(2023, 12, 25),
    date(2024, 1, 1), date(2024, 2, 12), date(2024, 2, 13), date(2024, 3, 24), date(2024, 3, 29), date(2024, 4, 2), date(2024, 5, 1), date(2024, 5, 25), date(2024, 6, 17), date(2024, 6, 20), date(2024, 7, 9), date(2024, 8, 17), date(2024, 10, 12), date(2024, 11, 18), date(2024, 12, 8), date(2024, 12, 25),
    date(2025, 1, 1), date(2025, 3, 3), date(2025, 3, 4), date(2025, 3, 24), date(2025, 4, 2), date(2025, 4, 18), date(2025, 5, 1), date(2025, 5, 25), date(2025, 6, 16), date(2025, 6, 20), date(2025, 7, 9), date(2025, 8, 17), date(2025, 10, 12), date(2025, 11, 24), date(2025, 12, 8), date(2025, 12, 25),
}

print(">> Generando DimTiempo...")
fechas = pd.date_range(FECHA_INICIO, FECHA_FIN, freq="D")
dim_tiempo = pd.DataFrame({
    "TiempoKey":       fechas.strftime("%Y%m%d").astype(int),
    "Fecha":           fechas.strftime("%Y-%m-%d"),
    "Anio":            fechas.year,
    "Trimestre":       fechas.quarter,
    "Mes":             fechas.month,
    "MesNombre":       [MES_NOMBRE[m] for m in fechas.month],
    "SemanaAnio":      fechas.isocalendar().week.astype(int).values,
    "Dia":             fechas.day,
    "DiaSemanaNumero": fechas.weekday + 1,
    "DiaSemanaNombre": [DIA_NOMBRE[d] for d in fechas.weekday],
    "EsFinDeSemana":   (fechas.weekday >= 5).astype(int),
    "EsFeriado":       [int(f.date() in FERIADOS) for f in fechas],
})

print(">> Generando DimSucursal...")
CIUDADES = [("CABA", "CABA", "AMBA", 6), ("La Matanza", "Buenos Aires", "AMBA", 2), ("Quilmes", "Buenos Aires", "AMBA", 2), ("Moron", "Buenos Aires", "AMBA", 2), ("San Isidro", "Buenos Aires", "AMBA", 2), ("Tigre", "Buenos Aires", "AMBA", 1), ("La Plata", "Buenos Aires", "AMBA", 2), ("Mar del Plata", "Buenos Aires", "PBA Interior", 2), ("Bahia Blanca", "Buenos Aires", "PBA Interior", 1), ("Rosario", "Santa Fe", "Centro", 3), ("Santa Fe", "Santa Fe", "Centro", 1), ("Cordoba", "Cordoba", "Centro", 3), ("Villa Maria", "Cordoba", "Centro", 1), ("Mendoza", "Mendoza", "Cuyo", 2), ("San Juan", "San Juan", "Cuyo", 1), ("San Miguel de Tucuman", "Tucuman", "NOA", 2), ("Salta", "Salta", "NOA", 2), ("Corrientes", "Corrientes", "NEA", 1), ("Resistencia", "Chaco", "NEA", 1), ("Posadas", "Misiones", "NEA", 1), ("Neuquen", "Neuquen", "Patagonia", 1), ("Bariloche", "Rio Negro", "Patagonia", 1), ("Comodoro Rivadavia", "Chubut", "Patagonia", 1)]
pesos_ciudad = np.array([c[3] for c in CIUDADES], dtype=float)
pesos_ciudad /= pesos_ciudad.sum()
FORMATOS = ["Hipermercado"] * 8 + ["Supermercado"] * 20 + ["Express"] * 12
rng.shuffle(FORMATOS)
RANGO_M2    = {"Hipermercado": (4500, 9000), "Supermercado": (900, 2500), "Express": (150, 500)}
RANGO_CAJAS = {"Hipermercado": (25, 55),     "Supermercado": (8, 18),     "Express": (2, 5)}
filas_suc, contador_ciudad = [], {}
for k in range(1, N_SUCURSALES + 1):
    ciudad, provincia, region, _ = CIUDADES[rng.choice(len(CIUDADES), p=pesos_ciudad)]
    contador_ciudad[ciudad] = contador_ciudad.get(ciudad, 0) + 1
    sufijo = f" {contador_ciudad[ciudad]}" if contador_ciudad[ciudad] > 1 else ""
    fmt = FORMATOS[k - 1]
    filas_suc.append({
        "SucursalKey":    k, "SucursalCodigo": f"SUC{k:03d}", "SucursalNombre": f"Sucursal {ciudad}{sufijo}", "Formato": fmt, "Direccion": fake.street_address(), "Ciudad": ciudad, "Provincia": provincia, "Region": region, "SuperficieM2": int(rng.integers(*RANGO_M2[fmt])), "CantidadCajas": int(rng.integers(*RANGO_CAJAS[fmt])), "FechaApertura": fake.date_between(date(1998, 1, 1), date(2022, 12, 31)).isoformat()
    })
dim_sucursal = pd.DataFrame(filas_suc)

print(">> Generando DimProducto...")
CATALOGO = {"Almacen": ({"Fideos y arroz": ["Fideos", "Arroz"], "Aceites": ["Aceite de girasol", "Aceite de oliva"], "Conservas": ["Atun", "Arvejas", "Tomate perita"], "Snacks": ["Galletitas", "Papas fritas"], "Desayuno": ["Mermelada", "Cafe", "Yerba", "Azucar", "Te"]}, "UN", 0.24, (800, 6000), 0), "Lacteos": ({"Leches": ["Leche entera", "Leche descremada"], "Yogures": ["Yogur bebible", "Yogur firme"], "Quesos": ["Queso cremoso", "Queso rallado"], "Mantecas y cremas": ["Manteca", "Crema de leche"], "Postres": ["Flan", "Postre de vainilla"]}, "UN", 0.26, (900, 8000), 1), "Bebidas": ({"Gaseosas": ["Gaseosa cola", "Gaseosa lima limon"], "Aguas": ["Agua mineral", "Agua saborizada", "Soda"], "Jugos": ["Jugo de naranja"], "Cervezas": ["Cerveza rubia", "Cerveza negra"], "Vinos": ["Vino tinto", "Vino blanco"]}, "UN", 0.28, (700, 9000), 0), "Carnes": ({"Vacuna": ["Asado", "Vacio", "Nalga", "Carne picada"], "Pollo": ["Pollo entero", "Pata muslo", "Suprema"], "Cerdo": ["Bondiola", "Matambre de cerdo", "Costillitas"]}, "KG", 0.30, (3000, 12000), 1), "Frutas y Verduras": ({"Frutas": ["Manzana", "Banana", "Naranja", "Pera", "Limon"], "Verduras": ["Papa", "Cebolla", "Tomate", "Lechuga", "Zanahoria", "Zapallo"]}, "KG", 0.38, (500, 4000), 1), "Fiambres": ({"Fiambres": ["Jamon cocido", "Salame", "Queso de maquina"], "Embutidos": ["Chorizo", "Morcilla"]}, "KG", 0.32, (4000, 15000), 1), "Panaderia": ({"Pan": ["Pan frances", "Pan lactal"], "Facturas": ["Facturas surtidas", "Medialunas"], "Reposteria": ["Budin", "Prepizza"]}, "UN", 0.35, (400, 5000), 1), "Congelados": ({"Hamburguesas": ["Hamburguesas", "Medallones de pollo"], "Verduras congeladas": ["Papas congeladas", "Espinaca congelada"], "Helados": ["Helado de crema", "Palito helado"], "Pescados": ["Filet de merluza", "Rabas"]}, "UN", 0.27, (1500, 12000), 0), "Limpieza": ({"Lavado de ropa": ["Jabon en polvo", "Jabon liquido"], "Cocina": ["Detergente", "Esponja", "Papel de cocina"], "Pisos y banio": ["Lavandina", "Limpiador de pisos"]}, "UN", 0.25, (900, 8000), 0), "Perfumeria": ({"Cuidado capilar": ["Shampoo", "Acondicionador"], "Higiene personal": ["Jabon de tocador", "Desodorante", "Pasta dental"], "Papeles": ["Papel higienico", "Toallitas humedas"]}, "UN", 0.29, (1200, 15000), 0), "Mascotas": ({"Perros": ["Alimento perro adulto", "Alimento cachorro", "Snack para perro"], "Gatos": ["Alimento gato", "Piedras sanitarias"]}, "UN", 0.22, (1500, 20000), 0), "Bazar": ({"Cocina": ["Vaso de vidrio", "Plato playo", "Sarten"], "Libreria": ["Cuaderno", "Biromes x3"], "Electro menor": ["Pila AA", "Lamparita led"]}, "UN", 0.18, (2000, 40000), 0)}
MARCAS = ["Campo Lindo", "La Huella", "Don Facundo", "Praderas", "Sol de Cuyo", "El Trigal", "Ondina", "Frescor", "Molino Real", "Dona Rosa", "Nandu", "Criolla", "Patagonia Sur", "Aromas del Litoral", "Estancia Grande", "Valle Verde", "Serrana", "Del Puerto"]
VAR_UN = ["500 g", "1 kg", "750 cc", "1 L", "1.5 L", "2.25 L", "x6", "x12", "Pack 2", "Clasico", "Light", "Premium", "Familiar", "250 g", "900 cc"]
VAR_KG = ["", "Premium", "Seleccion", "Organico", "Primera"]
cats = list(CATALOGO.keys())
peso_cat = np.array([3.0, 2.5, 2.5, 2.0, 2.0, 1.2, 1.2, 1.2, 1.8, 1.8, 0.8, 0.8]); peso_cat /= peso_cat.sum()
productos, nombres_usados = [], set()
while len(productos) < N_PRODUCTOS_BASE:
    cat = cats[rng.choice(len(cats), p=peso_cat)]
    subs_dict, unidad, margen, (pmin, pmax), perec = CATALOGO[cat]
    sub_nombres = list(subs_dict.keys())
    sub = sub_nombres[rng.integers(len(sub_nombres))]
    item = subs_dict[sub][rng.integers(len(subs_dict[sub]))]
    marca = MARCAS[rng.integers(len(MARCAS))]
    var = (VAR_KG if unidad == "KG" else VAR_UN)[rng.integers(len(VAR_KG if unidad == "KG" else VAR_UN))]
    nombre = " ".join(x for x in (item, marca, var) if x)
    if nombre in nombres_usados: continue
    nombres_usados.add(nombre)
    productos.append({"ProductoKey": len(productos) + 1, "ProductoCodigo": "779" + "".join(rng.choice(list("0123456789"), 10)), "ProductoNombre": nombre, "Marca": marca, "Categoria": cat, "Subcategoria": sub, "UnidadMedida": unidad, "EsPerecedero": perec, "FechaDesde": "2022-01-01", "FechaHasta": "", "EsVigente": 1, "_margen": margen, "_precio_base": round(float(np.exp(rng.uniform(np.log(pmin), np.log(pmax)))), 2)})
dim_producto = pd.DataFrame(productos)
idx_scd = rng.choice(N_PRODUCTOS_BASE, N_PRODUCTOS_SCD2, replace=False)
cambio_int = np.full(N_PRODUCTOS_BASE + 1, 99999999, dtype=np.int64)
key_nueva  = np.arange(N_PRODUCTOS_BASE + 1, dtype=np.int64)
filas_v2 = []
prox_key = N_PRODUCTOS_BASE + 1
for i in idx_scd:
    base = dim_producto.iloc[i]
    f_cambio = date(2024, 1, 1) + timedelta(days=int(rng.integers(180, 550)))
    subs = list(CATALOGO[base["Categoria"]][0].keys())
    nueva_sub = subs[(subs.index(base["Subcategoria"]) + 1) % len(subs)]
    dim_producto.loc[i, "FechaHasta"] = (f_cambio - timedelta(days=1)).isoformat()
    dim_producto.loc[i, "EsVigente"]  = 0
    v2 = base.to_dict()
    v2.update({"ProductoKey": prox_key, "Subcategoria": nueva_sub, "FechaDesde": f_cambio.isoformat(), "FechaHasta": "", "EsVigente": 1})
    filas_v2.append(v2)
    cambio_int[base["ProductoKey"]] = int(f_cambio.strftime("%Y%m%d"))
    key_nueva[base["ProductoKey"]]  = prox_key
    prox_key += 1
dim_producto = pd.concat([dim_producto, pd.DataFrame(filas_v2)], ignore_index=True)
precio_base, margen_cat, es_kg = np.zeros(N_PRODUCTOS_BASE + 1), np.zeros(N_PRODUCTOS_BASE + 1), np.zeros(N_PRODUCTOS_BASE + 1, dtype=bool)
base_rows = dim_producto[dim_producto["ProductoKey"] <= N_PRODUCTOS_BASE]
precio_base[base_rows["ProductoKey"]] = base_rows["_precio_base"]
margen_cat[base_rows["ProductoKey"]]  = base_rows["_margen"]
es_kg[base_rows["ProductoKey"]]       = (base_rows["UnidadMedida"] == "KG")

print(">> Generando DimCliente...")
SEGMENTOS, P_SEG, PESO_COMPRA = ["Ocasional", "Frecuente", "Premium"], [0.55, 0.35, 0.10], [1.0, 2.5, 4.5]
seg_idx = rng.choice(3, N_CLIENTES, p=P_SEG)
generos = rng.choice(["F", "M", "X"], N_CLIENTES, p=[0.52, 0.46, 0.02])
nacimientos = [fake.date_of_birth(minimum_age=18, maximum_age=85) for _ in range(N_CLIENTES)]
def rango_etario(nac):
    edad = (FECHA_FIN - nac).days // 365
    for tope, tag in [(25, "18-25"), (35, "26-35"), (45, "36-45"), (60, "46-60")]:
        if edad <= tope: return tag
    return "60+"
ciudades_cli = [CIUDADES[i] for i in rng.choice(len(CIUDADES), N_CLIENTES, p=pesos_ciudad)]
dim_cliente = pd.DataFrame({
    "ClienteKey": np.arange(1, N_CLIENTES + 1), "ClienteCodigo": [f"TF{n:08d}" for n in rng.choice(99999999, N_CLIENTES, replace=False)], "NombreCompleto": [fake.name() for _ in range(N_CLIENTES)], "Genero": generos, "FechaNacimiento": [n.isoformat() for n in nacimientos], "RangoEtario": [rango_etario(n) for n in nacimientos], "Ciudad": [c[0] for c in ciudades_cli], "Provincia": [c[1] for c in ciudades_cli], "SegmentoCliente": [SEGMENTOS[i] for i in seg_idx], "FechaAlta": [fake.date_between(date(2019, 1, 1), date(2023, 12, 31)).isoformat() for _ in range(N_CLIENTES)],
})
fila_cero = pd.DataFrame([{"ClienteKey": 0, "ClienteCodigo": "S/D", "NombreCompleto": "Consumidor Final", "Genero": "", "FechaNacimiento": "", "RangoEtario": "", "Ciudad": "", "Provincia": "", "SegmentoCliente": "No identificado", "FechaAlta": ""}])
dim_cliente = pd.concat([fila_cero, dim_cliente], ignore_index=True)

print(">> Generando FactVentas base (2024-2025)...")
PESO_MES = {1: 0.92, 2: 0.86, 3: 1.00, 4: 0.96, 5: 1.00, 6: 1.02, 7: 1.14, 8: 0.97, 9: 0.96, 10: 1.00, 11: 1.05, 12: 1.55}
PESO_DOW = [0.85, 0.90, 0.95, 1.00, 1.22, 1.52, 0.95]
fechas_2425 = pd.date_range(date(2024, 1, 1), date(2025, 12, 31), freq="D")
f_dates = fechas_2425.date
peso_dia = np.array([PESO_MES[f.month] * PESO_DOW[f.weekday()] * (0.55 if f in FERIADOS else 1.0) * (1.7 if (f.month == 12 and f.day in (20, 21, 22, 23, 24, 29, 30, 31)) else 1.0) * (1.06 if f.year == 2025 else 1.0) for f in f_dates])
peso_dia /= peso_dia.sum()

PESO_FORMATO = {"Hipermercado": 3.0, "Supermercado": 1.6, "Express": 0.8}
peso_suc = dim_sucursal["Formato"].map(PESO_FORMATO).to_numpy(dtype=float).copy(); peso_suc /= peso_suc.sum()
tk_dia_idx = rng.choice(len(fechas_2425), N_TICKETS, p=peso_dia)
tk_suc     = rng.choice(dim_sucursal["SucursalKey"].to_numpy(), N_TICKETS, p=peso_suc)
peso_cli = np.array([PESO_COMPRA[i] for i in seg_idx]); peso_cli /= peso_cli.sum()
tk_cli = np.where(rng.random(N_TICKETS) < PCT_SIN_TARJETA, 0, rng.choice(np.arange(1, N_CLIENTES + 1), N_TICKETS, p=peso_cli))

tickets = pd.DataFrame({"dia_idx": tk_dia_idx, "SucursalKey": tk_suc, "ClienteKey": tk_cli}).sort_values(["SucursalKey", "dia_idx"], ignore_index=True)
tickets["seq"] = tickets.groupby("SucursalKey").cumcount() + 1
tickets["NumeroTicket"] = ("T" + tickets["SucursalKey"].astype(str).str.zfill(3) + "-" + tickets["seq"].astype(str).str.zfill(7))
tickets["n_lineas"] = np.clip(rng.geometric(0.25, len(tickets)), 1, 15)

lineas = tickets.loc[tickets.index.repeat(tickets["n_lineas"])].reset_index(drop=True)
lineas["TiempoKey"] = [int(f_dates[i].strftime("%Y%m%d")) for i in lineas["dia_idx"]]
lineas["mes"]  = [f_dates[i].month for i in lineas["dia_idx"]]
lineas["anio"] = [f_dates[i].year for i in lineas["dia_idx"]]

popularidad = rng.lognormal(0, 1.1, N_PRODUCTOS_BASE)
orden_pop   = np.argsort(-popularidad) + 1
SURTIDO = {"Hipermercado": orden_pop[:N_PRODUCTOS_BASE], "Supermercado": orden_pop[:1200], "Express": orden_pop[:500]}
formato_suc = dict(zip(dim_sucursal["SucursalKey"], dim_sucursal["Formato"]))
lineas["formato"] = lineas["SucursalKey"].map(formato_suc)
prod_base = np.zeros(len(lineas), dtype=np.int64)
for fmt, surtido in SURTIDO.items():
    mask = (lineas["formato"] == fmt).to_numpy()
    p = popularidad[surtido - 1] / popularidad[surtido - 1].sum()
    prod_base[mask] = rng.choice(surtido, mask.sum(), p=p)

tiempo_int = lineas["TiempoKey"].to_numpy()
lineas["ProductoKey"] = np.where(tiempo_int >= cambio_int[prod_base], key_nueva[prod_base], prod_base)

meses_desde = (lineas["anio"].to_numpy() - 2024) * 12 + (lineas["mes"].to_numpy() - 1)
factor_infl = (1 + INFLACION_MENSUAL) ** meses_desde
cantidad = np.where(es_kg[prod_base], np.round(rng.uniform(0.15, 3.0, len(lineas)), 3), np.minimum(rng.geometric(0.55, len(lineas)), 6).astype(float))
precio_unit = np.round(precio_base[prod_base] * factor_infl * rng.uniform(0.97, 1.03, len(lineas)), 2)
bruto       = precio_unit * cantidad
desc        = np.where(rng.random(len(lineas)) < 0.12, np.round(bruto * rng.uniform(0.10, 0.30, len(lineas)), 2), 0.0)
neto        = np.round(bruto - desc, 2)
costo_unit  = precio_base[prod_base] * (1 - margen_cat[prod_base]) * factor_infl
costo_total = np.round(costo_unit * cantidad * rng.uniform(0.95, 1.05, len(lineas)), 2)

fact_ventas_2425 = pd.DataFrame({
    "TiempoKey": lineas["TiempoKey"], "ProductoKey": lineas["ProductoKey"], "SucursalKey": lineas["SucursalKey"], "ClienteKey": lineas["ClienteKey"], "NumeroTicket": lineas["NumeroTicket"], "Cantidad": cantidad, "PrecioUnitario": precio_unit, "ImporteDescuento": desc, "ImporteNeto": neto, "CostoTotal": costo_total, "MargenBruto": np.round(neto - costo_total, 2),
})

# --- INYECCIÓN DE COHORTE DE RECUPERACIÓN (31%) ---
print(">> Inyectando cohorte de recuperación (Campaña Oct 2025)...")
fv_15 = fact_ventas_2425[(fact_ventas_2425['ClienteKey'] != 0) & (fact_ventas_2425['TiempoKey'] <= 20251015)].merge(pd.DataFrame({'TiempoKey': [int(d.strftime('%Y%m%d')) for d in f_dates], 'Fecha': f_dates}), on='TiempoKey')
fv_15['Fecha'] = pd.to_datetime(fv_15['Fecha'])
vis_15 = fv_15.groupby(['ClienteKey', 'NumeroTicket'], as_index=False).agg(FechaVisita=('Fecha', 'min'), GastoTicket=('ImporteNeto', 'sum')).sort_values(['ClienteKey', 'FechaVisita', 'NumeroTicket'])
vis_15['DiasPrev'] = (vis_15['FechaVisita'] - vis_15.groupby('ClienteKey')['FechaVisita'].shift(1)).dt.days
met_15 = vis_15.groupby('ClienteKey', as_index=False).agg(VisitasTotales=('NumeroTicket', 'count'), FechaUltimaCompra=('FechaVisita', 'max'), GastoTotal=('GastoTicket', 'sum'), Frec=('DiasPrev', 'mean'))
met_15['DiasSinComprar'] = (pd.Timestamp('2025-10-15') - met_15['FechaUltimaCompra']).dt.days

df_285 = met_15[(met_15['VisitasTotales'] >= 3) & (met_15['DiasSinComprar'] >= 60) & (met_15['DiasSinComprar'] > 2.0 * met_15['Frec']) & (met_15['GastoTotal'] >= 100000)].sort_values('ClienteKey')
clientes_285 = df_285['ClienteKey'].tolist()
fact_ventas_2425 = fact_ventas_2425[~((fact_ventas_2425['ClienteKey'].isin(clientes_285)) & (fact_ventas_2425['TiempoKey'] >= 20251016) & (fact_ventas_2425['TiempoKey'] <= 20251115))].copy()

rng_mod = np.random.default_rng(99)
recuperados = rng_mod.choice(clientes_285, int(len(clientes_285) * 0.31), replace=False)
nuevas_recompras = []
prods_caros = [12, 48, 215, 467, 626, 831, 1500, 1610]
for idx, ck in enumerate(recuperados):
    dia_offset = rng_mod.integers(1, 28)
    tk_int = int((date(2025, 10, 15) + timedelta(days=int(dia_offset))).strftime("%Y%m%d"))
    suc_k = int((idx % 40) + 1)
    gasto_recompra = rng_mod.uniform(30000, 120000)
    for line_i in range(2):
        pk_base = prods_caros[(idx + line_i) % len(prods_caros)]
        pk_real = key_nueva[pk_base] if tk_int >= cambio_int[pk_base] else pk_base
        imp_linea = round(float(gasto_recompra) / 2.0, 2)
        nuevas_recompras.append({
            "TiempoKey": tk_int, "ProductoKey": pk_real, "SucursalKey": suc_k, "ClienteKey": ck,
            "NumeroTicket": f"T{suc_k:03d}-99{ck:04d}", "Cantidad": 2.0, "PrecioUnitario": round(imp_linea / 2.0, 2),
            "ImporteDescuento": 0.0, "ImporteNeto": imp_linea, "CostoTotal": round(imp_linea * 0.72, 2), "MargenBruto": round(imp_linea * 0.28, 2),
        })
fact_ventas_2425 = pd.concat([fact_ventas_2425, pd.DataFrame(nuevas_recompras)], ignore_index=True)

# --- CLONAR 2024 a 2023 CON VARIACION MENSUAL (Para YoY de PBI) ---
print(">> Generando FactVentas 2023 (clonado con variacion mensual)...")
fv_2024 = fact_ventas_2425[fact_ventas_2425['TiempoKey'] // 10000 == 2024].copy()
def shift_tk_1_year(tk):
    s = str(tk); y, m, d = int(s[:4]) - 1, int(s[4:6]), int(s[6:])
    if m == 2 and d == 29: d = 28
    return int(f"{y:04d}{m:02d}{d:02d}")

fv_2024['TiempoKey'] = fv_2024['TiempoKey'].apply(shift_tk_1_year)
target_yoy_24 = {1: 0.05, 2: 0.12, 3: -0.03, 4: -0.06, 5: 0.02, 6: -0.11, 7: 0.04, 8: -0.02, 9: 0.08, 10: 0.02, 11: -0.05, 12: 0.15}
target_inf_24 = {1: 2.2, 2: 2.3, 3: 2.4, 4: 2.5, 5: 2.45, 6: 2.6, 7: 2.7, 8: 2.55, 9: 2.4, 10: 2.5, 11: 2.6, 12: 2.8}

fv_2024['Mes'] = (fv_2024['TiempoKey'] % 10000) // 100
fv_2024['Cantidad'] = np.maximum(0.1, (fv_2024['Cantidad'] * fv_2024['Mes'].map(lambda m: 1.0 / (1.0 + target_yoy_24[m]))).round(3))
m_precio = fv_2024['Mes'].map(lambda m: 1.0 / target_inf_24[m])
fv_2024['PrecioUnitario'] = (fv_2024['PrecioUnitario'] * m_precio).round(2)
fv_2024['ImporteNeto'] = (fv_2024['ImporteNeto'] * m_precio).round(2)
fv_2024['CostoTotal'] = (fv_2024['CostoTotal'] * m_precio).round(2)
fv_2024['MargenBruto'] = (fv_2024['ImporteNeto'] - fv_2024['CostoTotal']).round(2)
fv_2024['ImporteDescuento'] = (fv_2024['ImporteDescuento'] * m_precio).round(2)
fv_2024['ClienteKey'] = 0
fv_2024['NumeroTicket'] = fv_2024['NumeroTicket'].str.replace('T', 'U')
fv_2024 = fv_2024.drop(columns=['Mes'])

fact_ventas = pd.concat([fv_2024, fact_ventas_2425], ignore_index=True)
fact_ventas = fact_ventas.sort_values(["TiempoKey", "SucursalKey", "NumeroTicket"], ignore_index=True)
fact_ventas.insert(0, "VentaID", np.arange(1, len(fact_ventas) + 1))

# ---------------------------------------------------------------
# 6. FactStockDiario (snapshot de fin de mes, 2023-2025)
# ---------------------------------------------------------------
print(">> Generando FactStockDiario (2023-2025)...")
fin_mes = pd.date_range(FECHA_INICIO, FECHA_FIN, freq="ME")
bloques = []
for snap in fin_mes:
    snap_int   = int(snap.strftime("%Y%m%d"))
    meses      = (snap.year - FECHA_INICIO.year) * 12 + (snap.month - 1)
    f_infl     = (1 + INFLACION_MENSUAL) ** meses
    p_quiebre  = 0.03 * PESO_MES[snap.month]
    for fmt, surtido in SURTIDO.items():
        sucs = dim_sucursal.loc[dim_sucursal["Formato"] == fmt, "SucursalKey"].to_numpy()
        n = len(sucs) * len(surtido)
        prod = np.tile(surtido, len(sucs))
        suc  = np.repeat(sucs, len(surtido))
        base_stock = 8 + popularidad[prod - 1] * 25 * PESO_FORMATO[fmt]
        unidades   = np.round(base_stock * rng.uniform(0.2, 1.6, n), 3)
        quiebre    = rng.random(n) < p_quiebre
        unidades[quiebre] = 0.0
        costo_u    = precio_base[prod] * (1 - margen_cat[prod]) * f_infl
        dias_sv    = np.minimum(rng.geometric(np.clip(popularidad[prod - 1] / 8, 0.05, 0.95)), 90)
        prod_vig = np.where(snap_int >= cambio_int[prod], key_nueva[prod], prod)
        bloques.append(pd.DataFrame({
            "TiempoKey": snap_int, "ProductoKey": prod_vig, "SucursalKey": suc, "StockUnidades": unidades, "StockValorizado": np.round(unidades * costo_u, 2), "DiasSinVenta": np.where(quiebre, 0, dias_sv), "QuiebreStock": quiebre.astype(int),
        }))
fact_stock = pd.concat(bloques, ignore_index=True).sort_values(["TiempoKey", "SucursalKey", "ProductoKey"], ignore_index=True)

# ---------------------------------------------------------------
# 8. EXPORTAR CSVs
# ---------------------------------------------------------------
print(">> Exportando CSVs...")
dim_producto = dim_producto.drop(columns=["_margen", "_precio_base"])

for col in ["Cantidad"]:
    fact_ventas[col] = fact_ventas[col].map(lambda x: f"{x:.3f}")
for col in ["PrecioUnitario", "ImporteDescuento", "ImporteNeto", "CostoTotal", "MargenBruto"]:
    fact_ventas[col] = fact_ventas[col].map(lambda x: f"{x:.2f}")
fact_stock["StockUnidades"]   = fact_stock["StockUnidades"].map(lambda x: f"{x:.3f}")
fact_stock["StockValorizado"] = fact_stock["StockValorizado"].map(lambda x: f"{x:.2f}")

EXPORTS = {"dim_tiempo.csv": dim_tiempo, "dim_producto.csv": dim_producto, "dim_sucursal.csv": dim_sucursal, "dim_cliente.csv": dim_cliente, "fact_ventas.csv": fact_ventas, "fact_stock_diario.csv": fact_stock}
for nombre, df in EXPORTS.items():
    df.to_csv(OUT_DIR / nombre, index=False, encoding="utf-8", lineterminator="\n")
print(f"\nListo. Archivos guardados en {OUT_DIR}/")
