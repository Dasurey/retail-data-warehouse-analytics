/* Smoke test de render (sin navegador ni API): bundlea la app real y
   renderiza los componentes clave con react-dom/server. Atrapa errores
   de runtime en el render inicial, imports rotos y violaciones de las
   reglas de hooks. Uso: npm run smoke */
import assert from 'node:assert/strict';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { crearQueryClient } from '../src/api/queryClient.js';
import App from '../src/App.jsx';
import AccionesAlerta from '../src/componentes/AccionesAlerta.jsx';
import EditorParametro from '../src/componentes/EditorParametro.jsx';
import ImpactoSimulacion from '../src/componentes/ImpactoSimulacion.jsx';
import BandejaAlertas from '../src/paginas/BandejaAlertas.jsx';

const envolver = (nodo) =>
  renderToString(
    <QueryClientProvider client={crearQueryClient()}>{nodo}</QueryClientProvider>
  ).replace(/<!-- -->/g, ''); // React separa text nodes con comentarios en SSR

let paso = 0;
const ok = (nombre) => console.log(`  OK ${++paso}. ${nombre}`);

// 1. La app sin sesion renderiza el login (usuario/contrasenia + token plan B)
let html = envolver(<App />);
assert.ok(html.includes('Panel de Administración'));
assert.ok(html.includes('Contraseña'));
assert.ok(html.includes('token de desarrollo'));
ok('App sin sesion muestra el login con el token como plan B');

// 2. El editor renderiza con un parametro real y su flujo inicial
html = envolver(
  <EditorParametro
    parametro={{
      Clave: 'DIAS_PISO_FUGA',
      ValorNumerico: 60,
      Descripcion: 'Piso de dias sin comprar',
      Modulo: 'FIDELIZACION',
      rango: [1, 365],
    }}
  />
);
assert.ok(html.includes('Simular impacto'));
assert.ok(html.includes('entre 1 y 365'));
assert.ok(!html.includes('Guardar cambio'), 'guardar no debe aparecer sin simulacion fresca');
ok('EditorParametro exige simular antes de habilitar el guardado');

// 3. El impacto renderiza las tres formas del contrato del backend
html = envolver(
  <ImpactoSimulacion
    simulacion={{
      simulable: true,
      impacto: {
        actual: { clientesFugados: 23, clientesAltoValor: 6, ingresoEnRiesgo: 3675582 },
        propuesto: { clientesFugados: 42, clientesAltoValor: 9, ingresoEnRiesgo: 5120000 },
      },
    }}
  />
);
assert.ok(html.includes('Clientes fugados'));
html = envolver(
  <ImpactoSimulacion
    simulacion={{
      simulable: true,
      impacto: {
        aniosComparados: [2024, 2025],
        varNominalPct: 74.1,
        actual: { varRealPct: 8.2 },
        propuesto: { varRealPct: 12.5 },
      },
    }}
  />
);
assert.ok(html.includes('moneda constante'));
ok('ImpactoSimulacion resuelve las formas fuga e inflacion del contrato');

// 4. Las acciones espejan la maquina de estados
html = envolver(
  <AccionesAlerta alerta={{ AlertaId: 1, Estado: 'NUEVA' }} />
);
assert.ok(html.includes('Tomar y asignar'));
html = envolver(
  <AccionesAlerta alerta={{ AlertaId: 2, Estado: 'EN_REVISION' }} />
);
assert.ok(html.includes('Marcar resuelta') && html.includes('Descartar'));
html = envolver(<AccionesAlerta alerta={{ AlertaId: 3, Estado: 'RESUELTA' }} />);
assert.ok(!html.includes('Marcar resuelta'), 'estados terminales no ofrecen acciones');
ok('AccionesAlerta pinta solo las transiciones validas por estado');

// 5. La bandeja renderiza su estado de carga
html = envolver(<BandejaAlertas />);
assert.ok(html.includes('Cargando alertas'));
ok('BandejaAlertas renderiza');

// 6. El grafico de descuentos lee los parametros vivos
const { default: GraficoDescuentos } = await import('../src/componentes/GraficoDescuentos.jsx');
html = envolver(
  <GraficoDescuentos
    parametrosFidelizacion={[
      { Clave: 'DESCUENTO_PREMIUM', ValorNumerico: 20 },
      { Clave: 'DESCUENTO_FRECUENTE', ValorNumerico: 15 },
      { Clave: 'DESCUENTO_OCASIONAL', ValorNumerico: 10 },
    ]}
  />
);
assert.ok(html.includes('Descuento del cupón por segmento'));
ok('GraficoDescuentos renderiza con datos de parametros');

// 7. Gestion de canales renderiza contra la API (estado de carga + alta)
const { default: GestionCanales } = await import('../src/componentes/GestionCanales.jsx');
html = envolver(<GestionCanales />);
assert.ok(html.includes('Canales de notificación'));
assert.ok(html.includes('Cargando canales'));
ok('GestionCanales renderiza conectado a /api/canales');

// 8. Estado del pipeline con su accion de disparo
const { default: EstadoPipeline } = await import('../src/componentes/EstadoPipeline.jsx');
html = envolver(<EstadoPipeline />);
assert.ok(html.includes('Pipeline de datos'));
assert.ok(html.includes('Ejecutar ahora'));
ok('EstadoPipeline renderiza con el boton de ejecucion encolada');

console.log('\nSMOKE RENDER COMPLETO: componentes, hooks e imports en orden.');
