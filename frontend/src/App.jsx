import { useEffect, useState } from 'react';
import { useLogin } from './api/hooks.js';
import {
  cerrarSesion,
  guardarSesion,
  guardarToken,
  obtenerToken,
  obtenerUsuario,
} from './api/token.js';
import BandejaAlertas from './paginas/BandejaAlertas.jsx';
import PantallaParametros from './paginas/PantallaParametros.jsx';

/* Login con usuario y contrasenia contra /api/auth/login. El token JWT
   resultante alimenta al resto de la app igual que antes; pegarlo a
   mano queda como plan B para desarrollo (token de npm run token). */
function FormularioLogin() {
  const login = useLogin();
  const [credenciales, setCredenciales] = useState({ usuario: '', password: '' });
  const [tokenManual, setTokenManual] = useState('');

  const alIngresar = (e) => {
    e.preventDefault();
    login.mutate(credenciales, {
      onSuccess: (datos) => {
        guardarSesion(datos);
        window.location.reload();
      },
    });
  };

  return (
    <div>
      <form className="form-inline" onSubmit={alIngresar}>
        <input
          value={credenciales.usuario}
          onChange={(e) => setCredenciales((c) => ({ ...c, usuario: e.target.value }))}
          placeholder="Usuario"
          aria-label="Usuario"
          autoComplete="username"
          style={{ maxWidth: 140 }}
        />
        <input
          type="password"
          value={credenciales.password}
          onChange={(e) => setCredenciales((c) => ({ ...c, password: e.target.value }))}
          placeholder="Contraseña"
          aria-label="Contraseña"
          autoComplete="current-password"
          style={{ maxWidth: 140 }}
        />
        <button
          type="submit"
          className="boton boton--primario"
          disabled={login.isPending || !credenciales.usuario || !credenciales.password}
        >
          {login.isPending ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
      {login.isError && (
        <p className="error" role="alert">
          {login.error.mensaje} ({login.error.codigo})
        </p>
      )}
      <details>
        <summary className="pista">¿Tenés un token de desarrollo?</summary>
        <form
          className="form-inline"
          onSubmit={(e) => {
            e.preventDefault();
            guardarToken(tokenManual.trim());
            window.location.reload();
          }}
        >
          <input
            type="password"
            value={tokenManual}
            onChange={(e) => setTokenManual(e.target.value)}
            placeholder="Pegá tu token"
            aria-label="Token de acceso"
            style={{ maxWidth: 220 }}
          />
          <button type="submit" className="boton boton--fantasma boton--chico" disabled={!tokenManual.trim()}>
            Usar token
          </button>
        </form>
      </details>
    </div>
  );
}

function SesionActiva() {
  const usuario = obtenerUsuario();
  return (
    <div className="form-inline">
      <span>
        Hola, <strong>{usuario?.nombre ?? 'usuario'}</strong>
        {usuario?.roles?.length > 0 && (
          <> <small>· {usuario.roles.join(', ')}</small></>
        )}
      </span>
      <button
        type="button"
        className="boton boton--fantasma boton--chico"
        onClick={() => {
          cerrarSesion();
          window.location.reload();
        }}
      >
        Salir
      </button>
    </div>
  );
}

export default function App() {
  const [pestania, setPestania] = useState('parametros');
  const [sesionExpirada, setSesionExpirada] = useState(false);
  const haySesion = Boolean(obtenerToken());

  useEffect(() => {
    const alExpirar = () => setSesionExpirada(true);
    window.addEventListener('sesion-expirada', alExpirar);
    return () => window.removeEventListener('sesion-expirada', alExpirar);
  }, []);

  return (
    <>
      <header className="encabezado">
        <div className="marca">
          <span className="marca__logo" aria-hidden="true">DW</span>
          <div>
            <h1>Panel de Administración</h1>
            <small>DW Supermercado · Retail Analytics</small>
          </div>
        </div>
        {haySesion ? <SesionActiva /> : <FormularioLogin />}
      </header>

      <main className="contenido">
        {sesionExpirada && (
          <p className="aviso" role="alert">
            Tu sesión expiró. Ingresá de nuevo con tu usuario y contraseña.
          </p>
        )}

        {!haySesion ? (
          <p className="vacio">
            Ingresá con tu usuario para ver el panel. Si todavía no tenés uno,
            se crea desde el backend: <code>npm run usuario</code>.
          </p>
        ) : (
          <>
            <nav className="pestanias" aria-label="Secciones">
              <button
                type="button"
                onClick={() => setPestania('parametros')}
                disabled={pestania === 'parametros'}
              >
                Parámetros
              </button>
              <button
                type="button"
                onClick={() => setPestania('alertas')}
                disabled={pestania === 'alertas'}
              >
                Alertas
              </button>
            </nav>

            {pestania === 'parametros' ? <PantallaParametros /> : <BandejaAlertas />}
          </>
        )}
      </main>
    </>
  );
}
