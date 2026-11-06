import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useActualizarParametro, useSimularParametro } from '../api/hooks.js';
import ImpactoSimulacion from './ImpactoSimulacion.jsx';

/**
 * Flujo completo del core del negocio:
 *   1. El admin edita el valor (validado contra el rango que publica la API).
 *   2. "Simular impacto" ejecuta las TVFs con el valor propuesto.
 *   3. Recien con una simulacion FRESCA (el valor no cambio despues de
 *      simular) se habilita guardar, que exige el motivo de auditoria.
 *
 * Montar con key={parametro.Clave} desde el padre: cambiar de parametro
 * remonta el componente y resetea formulario y simulacion sin efectos.
 */
export default function EditorParametro({ parametro, onGuardado, onCerrar }) {
  const [minimo, maximo] = parametro.rango ?? [-Infinity, Infinity];
  const [simulacion, setSimulacion] = useState(null);

  const esquema = useMemo(
    () =>
      z.object({
        valor: z.coerce
          .number({ invalid_type_error: 'Ingresa un numero' })
          .min(minimo, `El minimo permitido es ${minimo}`)
          .max(maximo, `El maximo permitido es ${maximo}`),
        motivo: z.string().trim()
          .min(5, 'Conta por que cambia (queda en la auditoria)')
          .max(300),
      }),
    [minimo, maximo]
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(esquema),
    mode: 'onChange',
    defaultValues: { valor: parametro.ValorNumerico, motivo: '' },
  });

  const simular = useSimularParametro();
  const guardar = useActualizarParametro();

  const valorIngresado = Number(watch('valor'));
  const simulacionFresca =
    simulacion != null && valorIngresado === simulacion.valorPropuesto;
  const sinCambio = valorIngresado === Number(parametro.ValorNumerico);

  const ejecutarSimulacion = () => {
    simular.mutate(
      { clave: parametro.Clave, valorPropuesto: valorIngresado },
      { onSuccess: setSimulacion }
    );
  };

  const confirmarGuardado = handleSubmit(({ valor, motivo }) => {
    guardar.mutate(
      { clave: parametro.Clave, valor, motivo },
      { onSuccess: () => onGuardado?.() }
    );
  });

  const errorVisible = simular.error ?? guardar.error;

  return (
    <form onSubmit={confirmarGuardado} aria-label={`Editar ${parametro.Clave}`}>
      <div className="modal__encabezado">
        <div>
          <span className="etiqueta">{parametro.Modulo}</span>
          <h3>{parametro.Clave}</h3>
          <p>
            <small>{parametro.Descripcion}</small>
          </p>
        </div>
        {onCerrar && (
          <button type="button" className="modal__cerrar" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        )}
      </div>

      <label className="campo">
        <span>Nuevo valor (entre {minimo} y {maximo})</span>
        <input type="number" step="any" {...register('valor')} disabled={guardar.isPending} />
      </label>
      {errors.valor && <p className="error" role="alert">{errors.valor.message}</p>}

      <div className="form-inline">
        <button
          type="button"
          className="boton boton--fantasma"
          onClick={ejecutarSimulacion}
          disabled={!!errors.valor || Number.isNaN(valorIngresado) || sinCambio || simular.isPending}
        >
          {simular.isPending ? 'Simulando…' : 'Simular impacto'}
        </button>
        {sinCambio && <p className="pista">El valor es el vigente: cambialo para simular.</p>}
      </div>

      {simulacion && (
        <section aria-live="polite" className="panel-impacto">
          <h4>
            Impacto de pasar de <span className="num">{simulacion.valorActual}</span> a{' '}
            <span className="num">{simulacion.valorPropuesto}</span>
          </h4>
          {simulacionFresca ? (
            <ImpactoSimulacion simulacion={simulacion} />
          ) : (
            <p className="pista">
              Cambiaste el valor despues de simular: volve a simular para ver el impacto real.
            </p>
          )}
        </section>
      )}

      {simulacionFresca && (
        <>
          <label className="campo">
            <span>Motivo del cambio (queda en la auditoria)</span>
            <textarea
              rows={2}
              placeholder="Ej: pedido de Comercial por la nueva pauta de inflacion"
              {...register('motivo')}
              disabled={guardar.isPending}
            />
          </label>
          {errors.motivo && <p className="error" role="alert">{errors.motivo.message}</p>}

          <button type="submit" className="boton boton--primario" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar cambio'}
          </button>
        </>
      )}

      {errorVisible && (
        <p className="error" role="alert">
          No se pudo completar: {errorVisible.mensaje} ({errorVisible.codigo})
        </p>
      )}
      {guardar.isSuccess && <p className="exito" role="status">Cambio guardado y auditado.</p>}
    </form>
  );
}
