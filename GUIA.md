# Guía: poner en línea y publicar noticias

Todo es gratis. Solo pagarás el dominio `.com` si decides comprarlo.

| Pieza | Para qué sirve | Costo |
|---|---|---|
| **GitHub** | Guarda los archivos del sitio y tus noticias | Gratis |
| **Cloudflare Pages** | Pone el sitio en internet (hasta 500 actualizaciones al mes) | Gratis |
| **Panel `/admin`** | Donde escribes noticias y subes fotos, desde la PC o el celular | Gratis |
| **Mercado Pago** | Cobra las suscripciones mensuales | Comisión por cobro |

---

## Paso 1 · Crear el repositorio en GitHub (una sola vez)

1. Crea una cuenta en **github.com**.
2. Arriba a la derecha, pulsa **+ → New repository**.
3. En el nombre escribe `jesus-prospero-web`. Puede ser **Private** (privado). Pulsa **Create repository**.
4. En la página que aparece, pulsa **uploading an existing file**.
5. Abre la carpeta `jesus-prospero-web` en tu computadora, selecciona **todo su contenido** (no la carpeta en sí) y arrástralo a la página. Pulsa **Commit changes**.

> **Antes de subir:** abre `src/admin/config.yml` con el Bloc de notas y cambia `TU_USUARIO_GITHUB` por tu usuario de GitHub. (O dímelo y lo cambio yo.)

## Paso 2 · Publicar el sitio en Cloudflare (una sola vez)

1. Crea una cuenta en **dash.cloudflare.com**.
2. Ve a **Workers y Pages → Crear → Pages → Conectar a Git** (en algunas versiones del panel dice *Importar un repositorio*).
3. Conecta tu cuenta de GitHub y elige `jesus-prospero-web`.
4. Configura así:
   - **Nombre del proyecto:** `jesusprospero` (tu sitio será `jesusprospero.pages.dev`)
   - **Comando de compilación:** `npm run build`
   - **Directorio de salida:** `_site`
5. Pulsa **Guardar e implementar**. En uno o dos minutos tu sitio estará en línea.

> Si el nombre `jesusprospero` ya está tomado, Cloudflare te dará otro. En ese caso cambia la dirección en `src/admin/config.yml` (líneas `site_url` y `display_url`) y en el panel, en **Ajustes del sitio**.

## Paso 3 · Crear tu llave de acceso al panel (una sola vez)

El panel usa una "llave" (token) de GitHub para guardar tus noticias.

1. En GitHub: tu foto (arriba a la derecha) → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Nombre:** `Panel noticias`. **Expiración:** la más larga que permita (cuando venza, crea otra igual).
3. **Repository access:** *Only select repositories* → `jesus-prospero-web`.
4. **Permissions → Repository permissions → Contents:** *Read and write*.
5. Pulsa **Generate token** y **cópialo**. GitHub lo muestra una sola vez: guárdalo en un lugar seguro, como el gestor de contraseñas de tu celular.

> Esta llave da acceso a tu sitio: no la compartas con nadie.

## Paso 4 · Publicar una noticia (el día a día)

1. Entra a **jesusprospero.pages.dev/admin** (o `tudominio.com/admin`).
   En el celular puedes usar *Agregar a pantalla de inicio* para tenerlo como una app.
2. La primera vez, elige **Iniciar sesión con un token de acceso** y pega tu llave.
3. Ve a **Noticias → Nueva noticia** y llena:
   - **Titular**: el mismo que pones en Instagram.
   - **Fecha y hora**: se llena sola con la hora actual.
   - **Bajada**: un resumen de una o dos líneas.
   - **Foto principal** y **Pie de foto** (opcionales). Las fotos del celular se comprimen solas al subirlas.
   - **Texto completo**: aquí te explayas. Puedes poner subtítulos, negritas, listas, enlaces y más fotos.
4. Pulsa **Guardar**. La noticia aparece en el sitio en uno o dos minutos.

**Para editar o borrar** una noticia, ábrela desde la lista de Noticias en el panel.

**Truco para Instagram:** pon en tu bio el link a tu sitio y en cada historia o post escribe "nota completa en el link de mi perfil". Cada noticia tiene botones para compartirla en WhatsApp, Facebook y X.

## Paso 5 · Primeros ajustes en el panel

- **Borra las dos noticias de ejemplo** (las que empiezan con "(Ejemplo)").
- En **Ajustes del sitio**, pon tu link de Instagram, tu correo y los **links de tus planes de Mercado Pago**. Mientras un plan no tenga link, su botón muestra "Este plan todavía no está disponible".

## Paso 6 (opcional) · Tu propio `.com`

1. En Cloudflare: **Registro de dominios → Registrar dominios**, busca `jesusprospero.com` y cómpralo (precio de costo, unos US$10–11 al año).
2. En tu proyecto de Pages: **Dominios personalizados → Configurar un dominio** y escribe `jesusprospero.com`. Como el dominio está en Cloudflare, se conecta solo.
3. En el panel, en **Ajustes del sitio**, cambia la **Dirección del sitio** a `https://jesusprospero.com`.

---

### Si algo falla

- **El sitio no se actualiza:** en Cloudflare, abre tu proyecto → **Implementaciones** y mira si la última dice *Error*. Copia el mensaje y pásamelo.
- **El panel dice que no puede entrar:** probablemente venció la llave. Crea una nueva (Paso 3).
