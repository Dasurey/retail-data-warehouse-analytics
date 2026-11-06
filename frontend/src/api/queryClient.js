import { QueryCache, QueryClient } from '@tanstack/react-query';
import { avisarSesionExpirada, limpiarToken } from './token.js';

export function crearQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      /* 401 en cualquier query => la sesion murio. Se maneja UNA vez aca,
         no en cada componente. */
      onError: (error) => {
        if (error?.status === 401) {
          limpiarToken();
          avisarSesionExpirada();
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        /* Reintentar solo errores de servidor: un 4xx va a fallar igual
           las 3 veces y solo demora el mensaje al usuario. */
        retry: (fallos, error) => (error?.status ?? 500) >= 500 && fallos < 2,
      },
      mutations: { retry: 0 },
    },
  });
}
