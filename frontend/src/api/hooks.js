import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './cliente.js';

/* Claves de cache centralizadas: la disciplina de queryKey es lo que
   hace que las invalidaciones sean quirurgicas y no un refetch-all. */
export const claves = {
  parametros: ['parametros'],
  historial: (clave) => ['parametros', clave, 'historial'],
  alertas: (filtros) => ['alertas', filtros],
  todasLasAlertas: ['alertas'],
};

/* ------------------------- Parametros ------------------------- */

export function useParametros() {
  return useQuery({
    queryKey: claves.parametros,
    queryFn: () => api.get('/parametros'),
    select: (datos) => {
      // Agrupar por modulo una sola vez, cacheado por react-query
      const porModulo = {};
      for (const p of datos.parametros) (porModulo[p.Modulo] ??= []).push(p);
      return porModulo;
    },
  });
}

export function useHistorialParametro(clave, habilitado) {
  return useQuery({
    queryKey: claves.historial(clave),
    queryFn: () => api.get(`/parametros/${clave}/historial`),
    enabled: habilitado,
  });
}

export function useSimularParametro() {
  return useMutation({
    mutationFn: ({ clave, valorPropuesto }) =>
      api.post('/parametros/simular', { clave, valorPropuesto }),
  });
}

export function useActualizarParametro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clave, valor, motivo }) =>
      api.put(`/parametros/${clave}`, { valor, motivo }),
    /* Sin actualizacion optimista a proposito: un parametro de negocio
       gobernado se muestra recien cuando la base lo confirmo. */
    onSuccess: (_datos, { clave }) => {
      qc.invalidateQueries({ queryKey: claves.parametros });
      qc.invalidateQueries({ queryKey: claves.historial(clave) });
    },
  });
}

/* --------------------------- Alertas --------------------------- */

export function useAlertas(filtros) {
  return useQuery({
    queryKey: claves.alertas(filtros),
    queryFn: () => api.get('/alertas', filtros),
    /* Mantiene la pagina anterior visible mientras llega la nueva:
       paginar no debe parpadear a "cargando". */
    placeholderData: keepPreviousData,
  });
}

/* Resumen para la dona de estados. Comparte el prefijo ['alertas'], asi
   que las mutaciones optimistas y las invalidaciones lo actualizan solo. */
export function useResumenAlertas() {
  return useQuery({
    queryKey: claves.alertas({ resumen: true, tamanio: 100 }),
    queryFn: () => api.get('/alertas', { tamanio: 100 }),
    select: (datos) => {
      const conteos = { NUEVA: 0, EN_REVISION: 0, RESUELTA: 0, DESCARTADA: 0 };
      for (const a of datos.alertas) conteos[a.Estado] = (conteos[a.Estado] ?? 0) + 1;
      return { conteos, total: datos.total, muestra: datos.alertas.length };
    },
  });
}

export function useCambiarEstadoAlerta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alertaId, estado, nota, asignadoA }) =>
      api.patch(`/alertas/${alertaId}/estado`, { estado, nota, asignadoA }),

    /* Actualizacion optimista sobre TODAS las paginas cacheadas de la
       bandeja: la fila cambia al instante y, si el backend rechaza la
       transicion (409 por carrera con otro operador), se revierte. */
    onMutate: async ({ alertaId, estado, asignadoA }) => {
      await qc.cancelQueries({ queryKey: claves.todasLasAlertas });
      const previas = qc.getQueriesData({ queryKey: claves.todasLasAlertas });
      qc.setQueriesData({ queryKey: claves.todasLasAlertas }, (datos) => {
        if (!datos?.alertas) return datos;
        return {
          ...datos,
          alertas: datos.alertas.map((a) =>
            a.AlertaId === alertaId
              ? { ...a, Estado: estado, AsignadoA: asignadoA ?? a.AsignadoA, _optimista: true }
              : a
          ),
        };
      });
      return { previas };
    },
    onError: (_error, _variables, contexto) => {
      contexto?.previas?.forEach(([clave, datos]) => qc.setQueryData(clave, datos));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: claves.todasLasAlertas }),
  });
}

/* ------------------------- Canales y pipeline ------------------------- */

export function useCanales() {
  return useQuery({ queryKey: ['canales'], queryFn: () => api.get('/canales') });
}

/* Config gobernada => sin optimismo, igual que los parametros: el canal
   se muestra recien cuando la base lo confirmo (cifrado incluido). */
export function useCrearCanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (canal) => api.post('/canales', canal),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canales'] }),
  });
}

export function useActualizarCanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ canalId, ...parche }) => api.patch(`/canales/${canalId}`, parche),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canales'] }),
  });
}

export function useEliminarCanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (canalId) => api.delete(`/canales/${canalId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canales'] }),
  });
}

export function useProbarCanal() {
  return useMutation({ mutationFn: (canalId) => api.post(`/canales/${canalId}/probar`) });
}

/* refetchInterval: mientras el orquestador procesa una solicitud, el
   estado avanza solo en pantalla sin recargar. */
export function usePipelineEstado() {
  return useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.get('/pipeline/estado'),
    // Mientras hay una corrida viva, el poll se acelera para ver el
    // avance SOLICITADA -> EN_CURSO -> OK casi en tiempo real.
    refetchInterval: (query) => {
      const estado = query.state.data?.ultimaCorrida?.Estado;
      return estado === 'SOLICITADA' || estado === 'EN_CURSO' ? 4_000 : 15_000;
    },
  });
}

export function useEjecutarPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/pipeline/ejecutar'),
    // Invalida incluso ante el 409 CORRIDA_EN_CURSO: el refetch trae la
    // corrida que esta bloqueando y la muestra.
    onSettled: () => qc.invalidateQueries({ queryKey: ['pipeline'] }),
  });
}

/* -------------------------------- Auth -------------------------------- */

export function useLogin() {
  return useMutation({
    mutationFn: ({ usuario, password }) => api.post('/auth/login', { usuario, password }),
  });
}
