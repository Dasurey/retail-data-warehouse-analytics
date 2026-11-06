import { useState } from 'react';
import { useActualizarCanal, useCanales, useCrearCanal, useEliminarCanal, useProbarCanal } from '../api/hooks.js';

/* =====================================================================
   Gestion de canales de notificacion CONTRA LA API (/api/canales).
   Reemplaza la card local de "destinatario": ahora el email o el
   telefono de guardia son canales reales, cifrados at-rest en la base,
   listados solo con su mascara (••••XXXX).
   ===================================================================== */

const PLACEHOLDERS = {
  slack: 'https://hooks.slack.com/services/T000/B000/…',
  teams: 'https://empresa.webhook.office.com/…',
  email: 'supply@supermercado.com.ar',
  sms: '+54 9 11 5555-5555',
};

/* Espejo de la validacion zod del backend: feedback inmediato en el
   form; la autoridad sigue siendo la API. */
function validarDestino(tipo, destino) {
  if (tipo === 'email')
    return /^\S+@\S+\.\S+$/.test(destino) ? null : 'Ingresá un email válido';
  if (tipo === 'sms')
    return /^[\d\s()+-]{6,20}$/.test(destino) ? null : 'Ingresá un teléfono válido';
  return destino.startsWith('https://') ? null : 'El webhook debe ser una URL https://';
}

function FilaCanal({ canal }) {
  const actualizar = useActualizarCanal();
  const eliminar = useEliminarCanal();
  const probar = useProbarCanal();
  const [prueba, setPrueba] = useState(null);

  const puedeProbar = canal.Tipo === 'slack' || canal.Tipo === 'teams' || canal.Tipo === 'email';

  const alProbar = () =>
    probar.mutate(canal.CanalId, {
      onSuccess: (r) => setPrueba({ ok: r.ok, status: r.status }),
      onError: (e) => setPrueba({ error: e }),
    });

  const alEliminar = () => {
    const confirmado = window.confirm(
      `Eliminar el canal "${canal.Nombre}"? Esta accion no se puede deshacer.`
    );
    if (!confirmado) return;
    eliminar.mutate(canal.CanalId);
  };

  return (
    <div className={`item-lista${canal.Activo ? '' : ' canal-inactivo'}`}>
      <div className="crecer">
        <strong>{canal.Nombre}</strong> <span className="chip chip--tipo">{canal.Tipo}</span>
        <br />
        <small className="num">{canal.DestinoMascara}</small>
      </div>

      {puedeProbar && (
        <button
          type="button"
          className="boton boton--fantasma boton--chico"
          onClick={alProbar}
          disabled={probar.isPending || !canal.Activo}
        >
          {probar.isPending ? 'Probando…' : 'Probar envío'}
        </button>
      )}
      <button
        type="button"
        className="boton boton--fantasma boton--chico"
        onClick={() => actualizar.mutate({ canalId: canal.CanalId, activo: !canal.Activo })}
        disabled={actualizar.isPending}
      >
        {canal.Activo ? 'Pausar' : 'Activar'}
      </button>
      <button
        type="button"
        className="boton boton--fantasma boton--chico"
        onClick={alEliminar}
        disabled={eliminar.isPending}
      >
        {eliminar.isPending ? 'Eliminando…' : 'Eliminar'}
      </button>

      {prueba?.ok && (
        <p className="exito" role="status">Mensaje de prueba enviado (HTTP {prueba.status}).</p>
      )}
      {prueba && prueba.ok === false && !prueba.error && (
        <p className="error" role="alert">El destino respondió HTTP {prueba.status}.</p>
      )}
      {prueba?.error && (
        <p className="error" role="alert">
          {prueba.error.mensaje} ({prueba.error.codigo})
        </p>
      )}
      {actualizar.isError && (
        <p className="error" role="alert">
          {actualizar.error.mensaje} ({actualizar.error.codigo})
        </p>
      )}
      {eliminar.isError && (
        <p className="error" role="alert">
          {eliminar.error.mensaje} ({eliminar.error.codigo})
        </p>
      )}
    </div>
  );
}

export default function GestionCanales() {
  const { data, isPending, isError, error, refetch } = useCanales();
  const crear = useCrearCanal();

  const [mostrandoAlta, setMostrandoAlta] = useState(false);
  const [formulario, setFormulario] = useState({ nombre: '', tipo: 'slack', destino: '' });
  const [errorForm, setErrorForm] = useState(null);

  const cambiar = (campo) => (e) => {
    setFormulario((previo) => ({ ...previo, [campo]: e.target.value }));
    setErrorForm(null);
  };

  const alCrear = (e) => {
    e.preventDefault();
    if (formulario.nombre.trim().length < 2) return setErrorForm('El nombre es muy corto');
    const errorDestino = validarDestino(formulario.tipo, formulario.destino.trim());
    if (errorDestino) return setErrorForm(errorDestino);

    crear.mutate(
      { ...formulario, nombre: formulario.nombre.trim(), destino: formulario.destino.trim() },
      {
        onSuccess: () => {
          setFormulario({ nombre: '', tipo: 'slack', destino: '' });
          setMostrandoAlta(false);
        },
      }
    );
  };

  return (
    <div className="tarjeta">
      <div className="tarjeta__encabezado">
        <span className="etiqueta">Notificaciones</span>
        <h3>Canales de notificación</h3>
      </div>

      {isPending && <p>Cargando canales…</p>}
      {isError && (
        <p className="error" role="alert">
          {error.mensaje ?? error.message}{' '}
          <button type="button" className="boton boton--fantasma boton--chico" onClick={() => refetch()}>
            Reintentar
          </button>
        </p>
      )}

      {data && data.canales.length === 0 && (
        <p className="vacio">Sin canales todavía. Creá el primero para recibir alertas.</p>
      )}
      {data && data.canales.map((c) => <FilaCanal key={c.CanalId} canal={c} />)}

      {!mostrandoAlta ? (
        <button
          type="button"
          className="boton boton--primario boton--chico"
          style={{ marginTop: 12 }}
          onClick={() => setMostrandoAlta(true)}
        >
          Nuevo canal
        </button>
      ) : (
        <form onSubmit={alCrear} noValidate>
          <label className="campo">
            <span>Nombre</span>
            <input value={formulario.nombre} onChange={cambiar('nombre')} placeholder="Supply guardia" />
          </label>
          <label className="campo">
            <span>Tipo</span>
            <select value={formulario.tipo} onChange={cambiar('tipo')}>
              <option value="slack">Slack (webhook)</option>
              <option value="teams">Teams (webhook)</option>
              <option value="email">Email</option>
              <option value="sms">SMS / teléfono</option>
            </select>
          </label>
          <label className="campo">
            <span>Destino (se guarda cifrado; después solo se ve la máscara)</span>
            <input
              value={formulario.destino}
              onChange={cambiar('destino')}
              placeholder={PLACEHOLDERS[formulario.tipo]}
            />
          </label>
          {errorForm && <p className="error" role="alert">{errorForm}</p>}
          {crear.isError && (
            <p className="error" role="alert">
              {crear.error.mensaje} ({crear.error.codigo})
            </p>
          )}
          <div className="form-inline">
            <button type="submit" className="boton boton--primario" disabled={crear.isPending}>
              {crear.isPending ? 'Creando…' : 'Crear canal'}
            </button>
            <button
              type="button"
              className="boton boton--fantasma"
              onClick={() => setMostrandoAlta(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
