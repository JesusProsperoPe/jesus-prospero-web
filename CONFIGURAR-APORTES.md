# Configurar los aportes mensuales (Mercado Pago)

Cómo queda armado:

```
Visitante → elige un plan en /suscribete/ → paga en Mercado Pago (sin cuenta en esta web)
         → Mercado Pago lo devuelve a /aporte/gracias/?preapproval_id=…
         → la web consulta a Mercado Pago el estado REAL y solo dice "activo" si está autorizado
Mercado Pago → avisa cada cambio a /api/mercadopago/webhook (firmado) → se guarda en la base D1
```

No se guardan correos, nombres ni datos de tarjeta. Solo: id de la suscripción, plan, monto, estado y fechas.

---

## 1 · Base de datos D1 (Cloudflare) — una sola vez

1. Cloudflare → **Storage & databases → D1 SQL database → Create database**.
2. Nombre: `jesus-prospero-aportes` → **Create**.
3. Copia el **Database ID** y pásaselo a Claude (no es secreto). Se pone en `wrangler.jsonc`.
4. En la base, abre la pestaña **Console**, pega el contenido de `migrations/0001_aportes.sql` y pulsa **Execute**.

## 2 · Aplicación de Mercado Pago — una sola vez

1. Entra a **mercadopago.com.pe/developers → Tus integraciones → Crear aplicación**.
   - Producto: **Suscripciones**.
2. En la aplicación, ve a **Credenciales de producción** y actívalas (Mercado Pago pide datos de tu negocio).
3. Copia el **Access Token de producción**. Es secreto: no lo pegues en el chat ni en archivos del sitio.

## 3 · Crear los 4 planes (S/3, S/5, S/10, S/20)

En PowerShell, dentro de la carpeta `jesus-prospero-web`:

```powershell
$env:MP_ACCESS_TOKEN = Read-Host "Pega tu Access Token"
& "$env:TEMP\jpnode\node-v20.20.2-win-x64\node.exe" scripts\crear-planes.mjs
```

El script crea los planes en soles, mensuales, con regreso a `https://jesusprospero.pe/aporte/gracias/`, y muestra los 4 links.
Si lo corres dos veces, no duplica planes.

Pega cada link en el panel: **Ajustes del sitio → Planes de aporte mensual**.

## 4 · Secretos en Cloudflare

Cloudflare → **Workers & Pages → jesus-prospero-web → Settings → Variables and Secrets → Add**:

| Nombre | Tipo | Valor |
|---|---|---|
| `MP_ACCESS_TOKEN` | **Secret** | Access Token de producción (paso 2) |
| `MP_WEBHOOK_SECRET` | **Secret** | Clave de las notificaciones (paso 5) |

## 5 · Notificaciones (webhooks) de Mercado Pago

1. En tu aplicación de Mercado Pago: **Webhooks → Configurar notificaciones** (modo productivo).
2. URL: `https://jesusprospero.pe/api/mercadopago/webhook`
3. Eventos: marca **Planes y suscripciones** (vinculación de suscripción y pago recurrente).
4. Guarda y copia la **clave secreta** → ponla en Cloudflare como `MP_WEBHOOK_SECRET` (paso 4).
5. Usa el botón **Simular** de Mercado Pago: la web debe responder 200.

## 6 · Prueba real (la única que confirma que cobra de verdad)

1. Suscríbete tú mismo al plan **Semilla (S/3)** desde `jesusprospero.pe/suscribete/`.
2. Al volver, la página debe decir **"¡Gracias! Tu aporte mensual está activo"**.
3. En D1 → Console: `SELECT * FROM suscripciones;` debe mostrar la suscripción `authorized`.
4. Cancélala desde Mercado Pago (ver `/aporte/gestionar/`) y confirma que en D1 pase a `cancelled`.

## 7 · Notas exclusivas: enlace de acceso por correo (Resend)

Sin esto, las notas exclusivas funcionan igual: quien se suscribe queda con acceso en ese navegador
y recibe su enlace personal. Esto solo activa el botón "¿Ya eres suscriptor? Ingresa".

1. Crea una cuenta gratis en **resend.com** (3 000 correos al mes).
2. **Domains → Add domain** → `jesusprospero.pe` → usa **Connect with Cloudflare** para que agregue los registros DNS solo.
   Espera a que diga **Verified**.
3. **API Keys → Create API key** (permiso: *Sending access*, dominio `jesusprospero.pe`). Cópiala; es secreta.
4. Cloudflare → **Workers & Pages → jesus-prospero-web → Settings → Variables and Secrets → Add**:
   tipo **Secret**, nombre `RESEND_API_KEY`, valor: la clave. Guarda.
5. Prueba: en una nota exclusiva, "¿Ya eres suscriptor? Ingresa" con el correo de tu suscripción de Mercado Pago.

Los correos salen de `acceso@jesusprospero.pe`. Para cambiarlo, agrega la variable normal `CORREO_REMITENTE`.

Para revisar los aportes más adelante: D1 → Console:

```sql
SELECT estado, COUNT(*) AS cantidad, SUM(monto) AS soles_al_mes FROM suscripciones GROUP BY estado;
```
